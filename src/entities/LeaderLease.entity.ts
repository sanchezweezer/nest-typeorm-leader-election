import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ synchronize: false })
export class LeaderLease {
  @PrimaryColumn({ type: "integer" })
  id: number;

  @Column({ type: "text", nullable: false, name: "leader_id" })
  leaderId: string;

  @Column({ type: "timestamptz", name: "expires_at" })
  expiresAt: Date;

  @Column({
    type: "timestamptz",
    name: "created_at",
    default: () => "CURRENT_TIMESTAMP",
  })
  createdAt: Date;
}
