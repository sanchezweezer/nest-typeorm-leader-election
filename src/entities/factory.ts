import { EntitySchema } from "typeorm";
import { LeaderLease } from "./LeaderLease.entity.js";

export const createLeaderLeaseEntity = (schema: string = "public") => {
  return new EntitySchema<LeaderLease>({
    name: "LeaderLease",
    tableName: "leader_lease",
    schema: schema,
    columns: {
      id: {
        type: "integer",
        primary: true,
      },
      leaderId: {
        name: "leader_id",
        type: "text",
        nullable: false,
      },
      expiresAt: {
        name: "expires_at",
        type: "timestamptz",
        nullable: false,
      },
      createdAt: {
        name: "created_at",
        type: "timestamptz",
        default: () => "CURRENT_TIMESTAMP",
        nullable: false,
      },
    },
    checks: [
      {
        expression: `expires_at > created_at`,
      },
    ],
  });
};
