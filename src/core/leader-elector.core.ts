import { Logger } from "@nestjs/common";
import { Repository, type DataSource } from "typeorm";
import { LeaderLease, createLeaderLeaseEntity } from "../entities/index.js";

export interface LeaderElectorConfig {
  leaseDuration: number;
  renewalInterval?: number;
  jitterRange?: number;
  lockId?: number;
  instanceId?: string;
  schema?: string;
}

export class LeaderElectorCore {
  name = "LeaderElector";
  private readonly logger = new Logger(LeaderElectorCore.name);
  private readonly LOCK_ID: number;
  private isLeader = false;
  private renewalTimer?: NodeJS.Timeout;
  private readonly baseLeaseDuration: number;
  private readonly baseRenewalInterval: number;
  private readonly jitterRange: number;
  private readonly instanceId: string;
  private readonly schema: string;

  constructor(
    private readonly leaderLeaseRepository: Repository<LeaderLease>,
    config: LeaderElectorConfig,
  ) {
    this.baseLeaseDuration = config.leaseDuration ?? 10_000;
    this.baseRenewalInterval =
      config.renewalInterval ?? config.leaseDuration / 3;
    this.jitterRange = config.jitterRange ?? 2_000;
    this.LOCK_ID = config.lockId ?? 1;
    this.schema = config.schema ?? "public";
    this.instanceId =
      config.instanceId ?? Math.random().toString(36).substring(2, 8);
  }

  static async create(
    dataSource: DataSource,
    config: LeaderElectorConfig,
  ): Promise<LeaderElectorCore> {
    const entity = createLeaderLeaseEntity(config.schema);
    const repository = dataSource.getRepository<LeaderLease>(entity);

    const elector = new LeaderElectorCore(repository, config);
    await elector.initialize();
    return elector;
  }

  protected async initialize() {
    await this.createLockTableIfNotExists();
    this.startCleanupJob();
    this.tryAcquireLeaseWithJitter();
  }

  private getJitter(): number {
    return Math.random() * this.jitterRange - this.jitterRange / 2;
  }

  private async createLockTableIfNotExists(): Promise<void> {
    await this.leaderLeaseRepository.query(`
        CREATE TABLE IF NOT EXISTS ${this.schema}.leader_lease (
          id INT PRIMARY KEY,
          leader_id TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (expires_at > created_at)
        );

        CREATE INDEX IF NOT EXISTS leader_lease_expires
        ON ${this.schema}.leader_lease (expires_at);
      `);
  }

  private startCleanupJob() {
    setInterval(() => this.cleanupExpiredLeases(), 60_000 + this.getJitter());
  }

  private async cleanupExpiredLeases() {
    try {
      const result = await this.leaderLeaseRepository
        .createQueryBuilder()
        .delete()
        .where("expiresAt < NOW() - INTERVAL '5 seconds'")
        .execute();

      this.logger.log(`Cleaned ${result.affected} expired leases`);
    } catch (error) {
      this.logger.error("Cleanup failed:", error);
    }
  }

  private tryAcquireLeaseWithJitter() {
    const delay = this.baseRenewalInterval + this.getJitter();
    setTimeout(() => this.tryAcquireLease(), delay);
  }

  private async tryAcquireLease() {
    const queryRunner =
      this.leaderLeaseRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Попытка продления существующей аренды
      const renewalResult = await queryRunner.manager.update(
        LeaderLease,
        { id: this.LOCK_ID, leaderId: this.instanceId },
        { expiresAt: () => `NOW() + INTERVAL '${this.baseLeaseDuration} ms'` },
      );

      if (renewalResult.affected! > 0) {
        await queryRunner.commitTransaction();
        this.handleLeadershipAcquired();
        return;
      }

      // 2. Попытка захвата новой аренды
      const newLease = this.leaderLeaseRepository.create({
        id: this.LOCK_ID,
        leaderId: this.instanceId,
        expiresAt: new Date(Date.now() + this.baseLeaseDuration),
      });

      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(LeaderLease)
        .values(newLease)
        .orIgnore()
        .execute();

      const currentLeader = await queryRunner.manager.findOne(LeaderLease, {
        where: { id: this.LOCK_ID },
      });

      if (!currentLeader || currentLeader.expiresAt < new Date()) {
        await queryRunner.manager.upsert(
          LeaderLease,
          {
            id: this.LOCK_ID,
            leaderId: this.instanceId,
            expiresAt: newLease.expiresAt,
          },
          ["id"],
        );

        this.handleLeadershipAcquired();
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error("Lease operation failed:", error);
    } finally {
      await queryRunner.release();
      if (!this.isLeader) {
        this.tryAcquireLeaseWithJitter();
      }
    }
  }

  private handleLeadershipAcquired() {
    if (!this.isLeader) {
      this.logger.log("🎉 Acquired leadership");
      this.isLeader = true;
    }
    this.scheduleLeaseRenewal();
  }

  private scheduleLeaseRenewal() {
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    const interval = this.baseRenewalInterval + this.getJitter();
    this.renewalTimer = setTimeout(() => this.tryAcquireLease(), interval);
  }

  public async release() {
    await this.leaderLeaseRepository.delete({
      id: this.LOCK_ID,
      leaderId: this.instanceId,
    });

    this.isLeader = false;
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    this.logger.log("Released leadership gracefully");
  }

  public async shutdown() {
    await this.release();
  }

  public amILeader(): boolean {
    return this.isLeader;
  }
}
