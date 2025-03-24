# NestJS Leader Election

[![npm version](https://img.shields.io/npm/v/nest-leader-election.svg)](https://www.npmjs.com/package/nest-leader-election)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Distributed leader election for NestJS applications using TypeORM and PostgreSQL.

## Problem Statement

In distributed systems and clustered environments, the following challenges often arise:

- **Resource Conflicts**
  Multiple application instances may simultaneously attempt to:
  - Execute periodic tasks (cron jobs)
  - Modify shared data
  - Send duplicate notifications

- **Execution Reliability**
  - No guarantee tasks will complete if any node fails
  - Risk of data corruption with concurrent access

- **Resource Efficiency**
  - Redundant resource consumption from duplicate operations
  - Inability to balance stateful operations

- **Implementation Complexity**
  - Requires low-level work with locks and transactions
  - No standardized way to manage leader lifecycle

**How This Library Helps**:
- ✅ Ensures **single executor** for critical operations
- ✅ Provides **automatic leadership failover** during failures
- ✅ Prevents **concurrent access** to shared resources
- ✅ Offers **ready-to-use abstractions** for NestJS applications
- ✅ Solves **split-brain** via database atomic operations

**Typical Use Cases**:
- Executing periodic tasks (DB migrations, email campaigns)
- Coordinating distributed transactions
- Managing access to exclusive resources
- Orchestrating background processes in Kubernetes clusters

## Features

- 🚀 NestJS DI Integration
- 🛡 Automatic Lease Renewal
- 🔄 Cluster and Horizontal Scaling Support
- ⚡️ Split-Brain Protection via Advisory Locks
- 🧩 Ready-to-Use Controller Decorators
- 📦 Standalone Mode for Non-NestJS Usage

## Installation
```bash
npm install nest-leader-election @nestjs/core @nestjs/typeorm typeorm pg reflect-metadata
```
## Quick Start
1. Import Module
```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaderElectorModule } from 'nest-leader-election';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'test',
      autoLoadEntities: true,
    }),
    LeaderElectorModule.forRoot({
          schema: 'schema_name',
    }),
  ],
})
export class AppModule {}
```
2. Use in Services
```typescript
// tasks.service.ts
import { Injectable } from '@nestjs/common';
import { LeaderElectorService } from 'nest-leader-election';

@Injectable()
export class TasksService {
  constructor(private readonly leaderElector: LeaderElectorService) {}

  async performCriticalTask() {
    if (this.leaderElector.amILeader()) {
      // Logic executed only by the leader
      console.log('Performing leader-only task');
    }
  }
}
```

## Configuration
  - Module Settings
    ```typescript
      LeaderElectorModule.forRoot({
        leaseDuration: 15000,  // Lease duration in ms (default: 10000)
        renewalInterval: 5000, // Renewal interval (default: 3000)
        jitterRange: 2000,     // Request timing variance (default: 2000)
        lockId: 12345,         // Lock identifier (default: 1)
      })
    ````
  - Environment Variables
    ```bash
        LE_LEASE_DURATION=15000
        LE_RENEWAL_INTERVAL=5000
        LE_JITTER_RANGE=2000
        LE_LOCK_ID=12345
    ````

## Standalone Usage

```typescript
import { DataSource } from 'typeorm';
import { LeaderElectorCore, LeaderLease } from 'nest-leader-election';

async function bootstrap() {
  const dataSource = new DataSource({
    type: 'postgres',
    // ... configuration
    entities: [LeaderLease],
  });

  await dataSource.initialize();

  const elector = new LeaderElectorCore(
    dataSource.getRepository(LeaderLease),
    {
      leaseDuration: 15000,
      instanceId: 'my-app-01'
    }
  );

  setInterval(() => {
    if (elector.amILeader()) {
      console.log('Performing leader task');
    }
  }, 1000);
}

bootstrap();
```

## API
- `LeaderElectorService`
    - `amILeader(): boolean` - Check leadership status
    - `release(): Promise<void>` - Release leadership

## Best Practices
- Always configure `leaseDuration` 2-3x longer than renewalInterval
- Use unique `lockId` for different services
- Monitor `leader_lease` table

## Operation logic
1. Initialization
- Table creation:
First, the `leader_lease` table will start to exist. If the table does not exist, it will be created with the following fields:
- `id` (lock identifier)
- `leader_id` (unique node identifier)
- `expires_at` (lease expiration time)
- `created_at` (record creation time)

- Indexes and constraints:
An index is created for quick determination by `expires_at` and a CHECK constraint that guarantees the correctness of timestamps.

2. Lease mechanism
- Leadership capture:
- The node tries to insert a new record with `expires_at = NOW() LeaseDuration`.
- If the record already exists:
- Proves that the current lease has not expired `(expires_at < NOW())`.
- If the lease has expired, atomically update the entry, setting its `leader_id` and a new `expires_at`.

3. Renewing Leadership
- Periodic update:
- The current leader updates the `expires_at` of the `renewalInterval(±jitter)` service to renew the lease.

- Jitter mechanism:
- Random delay (±2 seconds by default) between synchronization attempts, to accommodate requests from different nodes.

4. Releasing Leadership
- Explicitly calling `release()`:
Deletes the entry with the current `leader_id`.

- Automatic release:
If the leader fails to renew the lease, other nodes automatically take over the leadership via `leaseDuration`.

5. Cleanup sensitive records
- Background task:
Every `6 × LeaseDuration (± jitter)` records are committed where `expires_at < NOW() - 5 sec`.
- Goal: Prevent accumulation of "dead" records of standard records.

### This algorithm is ideal for:
- 3-node+ clusters
- A system where Kubernetes Leader Election cannot be used
- Scenarios with requirements for atomicity of operations
