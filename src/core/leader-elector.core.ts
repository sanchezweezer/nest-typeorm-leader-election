import { Logger } from "@nestjs/common";
import { Repository, type DataSource, QueryFailedError } from "typeorm";
import { LeaderLease, createLeaderLeaseEntity } from "../entities/index.js";

export interface LeaderElectorConfig {
  leaseDuration?: number;
  renewalInterval?: number;
  baseCleanInterval?: number;
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
  private readonly baseCleanInterval: number;
  private readonly baseRenewalInterval: number;
  private readonly jitterRange: number;
  private readonly instanceId: string;
  private readonly schema: string;

  constructor(
    private readonly leaderLeaseRepository: Repository<LeaderLease>,
    config: LeaderElectorConfig,
  ) {
    this.baseLeaseDuration = config.leaseDuration ?? 30_000;
    this.baseCleanInterval =
      config.baseCleanInterval ?? this.baseLeaseDuration * 2;
    this.baseRenewalInterval =
      config.renewalInterval ?? this.baseLeaseDuration / 3;
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
    // TODO: может стоит перенести очистку только на лидера?
    await this.startCleanupJob();
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

        CREATE UNIQUE INDEX IF NOT EXISTS leader_lease_id_leader_id_unique
            on leader_schema.leader_lease (id, leader_id);

        CREATE INDEX IF NOT EXISTS leader_lease_expires
        ON ${this.schema}.leader_lease (expires_at);
      `);
  }

  private async startCleanupJob() {
    await this.cleanupExpiredLeases();
    setInterval(
      () => this.cleanupExpiredLeases(),
      this.baseCleanInterval + this.getJitter(),
    );
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
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    const interval = this.baseRenewalInterval + this.getJitter();
    this.renewalTimer = setTimeout(() => this.tryAcquireLease(), interval);
  }

  private async tryAcquireLease() {
    const queryRunner =
      this.leaderLeaseRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Попытка атомарного upsert
      await queryRunner.manager.upsert(
        LeaderLease,
        {
          id: this.LOCK_ID,
          leaderId: this.instanceId,
          expiresAt: () => `NOW() + INTERVAL '${this.baseLeaseDuration} ms'`,
        },
        {
          conflictPaths: ["id", "leaderId"],
          skipUpdateIfNoValuesChanged: true,
        },
      );

      // 2. Проверка, является ли текущий узел лидером
      const currentLease = await queryRunner.manager.findOne(LeaderLease, {
        where: { id: this.LOCK_ID },
      });

      if (currentLease?.leaderId === this.instanceId) {
        this.handleLeadershipAcquired();
      } else if (this.isLeader) {
        await this.release();
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (
        error instanceof QueryFailedError &&
        error.driverError.code === "23505" &&
        ["leader_lease_pkey", "leader_lease_pk"].includes(
          error.driverError.constraint,
        )
      ) {
        this.logger.error("Lease operation failed: other instance is leader");
      } else {
        this.logger.error("Lease operation failed:", error);
      }
      await this.release();
    } finally {
      await queryRunner.release();
      this.tryAcquireLeaseWithJitter();
    }
  }

  private handleLeadershipAcquired() {
    if (!this.isLeader) {
      this.logger.log("🎉 Acquired leadership");
      this.isLeader = true;
    }
  }

  public async release() {
    // сначала выключаем локальную логику
    if (this.isLeader) {
      this.isLeader = false;
      if (this.renewalTimer) clearTimeout(this.renewalTimer);

      await this.leaderLeaseRepository.delete({
        id: this.LOCK_ID,
        leaderId: this.instanceId,
      });

      this.logger.log("Released leadership gracefully");
    }
  }

  public async shutdown() {
    await this.release();
  }

  public amILeader(): boolean {
    return this.isLeader;
  }
}
