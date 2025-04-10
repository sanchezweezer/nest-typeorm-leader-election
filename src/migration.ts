import { MigrationInterface, QueryRunner } from "typeorm";

export class LeaderElectionBase implements MigrationInterface {
  schema = "public";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS ${this.schema}.leader_lease_expires;
      DROP TABLE IF EXISTS ${this.schema}.leader_lease;
    `);
  }
}
