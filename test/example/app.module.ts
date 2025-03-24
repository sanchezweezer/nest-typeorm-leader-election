import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeaderElectorModule, LeaderLease } from "../../src/index.js";
import { DataSource } from "typeorm";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: "postgres",
        host: process.env.DB_HOST,
        port: +(process.env.DB_PORT || 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: true,
        logging: ["query", "error"],
        entities: [LeaderLease],
      }),
      dataSourceFactory: async (options) => {
        if (!options) throw new Error("Options are required");
        const dataSource = await new DataSource(options).initialize();

        return dataSource;
      },
    }),
    LeaderElectorModule.forRoot({
      schema: process.env.DB_SCHEMA,
      leaseDuration: 15000,
    }),
  ],
})
export class AppModule {}
