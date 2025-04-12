import { MigrationInterface, QueryRunner } from "typeorm";
import { createLeaderLeaseTable } from "./entities/factory.js";

export class LeaderElectionMigrationBase implements MigrationInterface {
  schema = "public";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(createLeaderLeaseTable(this.schema), true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(createLeaderLeaseTable(this.schema), true);
  }
}
