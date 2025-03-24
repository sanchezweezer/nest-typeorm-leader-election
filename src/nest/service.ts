import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, type DataSource } from "typeorm";
import {
  LeaderElectorCore,
  LeaderElectorConfig,
} from "../core/leader-elector.core.js";
import { LeaderLease, createLeaderLeaseEntity } from "../entities/index.js";

@Injectable()
export class LeaderElectorService
  extends LeaderElectorCore
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(
    @InjectRepository(LeaderLease)
    leaseRepository: Repository<LeaderLease>,
    config: LeaderElectorConfig,
  ) {
    super(leaseRepository, config);
  }

  static async create(
    dataSource: DataSource,
    config: LeaderElectorConfig,
  ): Promise<LeaderElectorCore> {
    const entity = createLeaderLeaseEntity(config.schema);
    const repository = dataSource.getRepository<LeaderLease>(entity);

    const elector = new LeaderElectorService(repository, config);
    await elector.initialize();
    return elector;
  }

  async onModuleInit() {
    await this.initialize();
  }

  async onApplicationShutdown() {
    await this.shutdown();
  }
}
