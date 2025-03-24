import { Module, DynamicModule, Provider } from "@nestjs/common";
import { TypeOrmModule, getRepositoryToken } from "@nestjs/typeorm";
import { type Repository, DataSource } from "typeorm";
import { LeaderLease, createLeaderLeaseEntity } from "../entities/index.js";
import { LeaderElectorService } from "./service.js";
import { LeaderElectorConfig } from "../core/leader-elector.core.js";

@Module({})
export class LeaderElectorModule {
  static forRoot(config: LeaderElectorConfig): DynamicModule {
    const entity = createLeaderLeaseEntity(config.schema);
    const repositoryProvider: Provider = {
      provide: getRepositoryToken(entity),
      useFactory: (dataSource: DataSource) => dataSource.getRepository(entity),
      inject: [DataSource],
    };

    return {
      module: LeaderElectorModule,
      imports: [TypeOrmModule.forFeature([entity])],
      providers: [
        repositoryProvider,
        {
          provide: LeaderElectorService,
          useFactory: (repo: Repository<LeaderLease>) =>
            new LeaderElectorService(repo, config),
          inject: [getRepositoryToken(entity)],
        },
      ],
      exports: [LeaderElectorService],
    };
  }
}
