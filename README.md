# NestJS Leader Election

[![npm version](https://img.shields.io/npm/v/nest-leader-election.svg)](https://www.npmjs.com/package/nest-leader-election)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Распределенный выбор лидера для NestJS приложений с использованием TypeORM и PostgreSQL.

## Особенности

- 🚀 Интеграция с NestJS DI
- 🛡 Автоматическое продление аренды
- 🔄 Поддержка кластеров и горизонтального масштабирования
- ⚡️ Защита от "split-brain" через Advisory Locks
- 🧩 Готовые декораторы для контроллеров
- 📦 Standalone режим для использования вне NestJS

## Установка

```bash
npm install nest-leader-election @nestjs/core @nestjs/typeorm typeorm pg reflect-metadata
```
## Быстрый старт
1. Импорт модуля
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
2. Использование в сервисе
```typescript
// tasks.service.ts
import { Injectable } from '@nestjs/common';
import { LeaderElectorService } from 'nest-leader-election';

@Injectable()
export class TasksService {
  constructor(private readonly leaderElector: LeaderElectorService) {}

  async performCriticalTask() {
    if (this.leaderElector.amILeader()) {
      // Логика, выполняемая только лидером
      console.log('Performing leader-only task');
    }
  }
}
```

## Конфигурация
  - Настройки модуля
    ```typescript
      LeaderElectorModule.forRoot({
        leaseDuration: 15000,  // Время аренды в ms (по умолчанию: 10000)
        renewalInterval: 5000, // Интервал продления (по умолчанию: 3000)
        jitterRange: 2000,     // Разброс времени запросов (по умолчанию: 2000)
        lockId: 12345,         // Идентификатор блокировки (по умолчанию: 1)
      })
    ````
  - Переменные окружения
    ```bash
        LE_LEASE_DURATION=15000
        LE_RENEWAL_INTERVAL=5000
        LE_JITTER_RANGE=2000
        LE_LOCK_ID=12345
    ````

## Standalone использование

```typescript
import { DataSource } from 'typeorm';
import { LeaderElectorCore, LeaderLease } from 'nest-leader-election';

async function bootstrap() {
  const dataSource = new DataSource({
    type: 'postgres',
    // ... конфигурация
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
    - `amILeader(): boolean` - Проверка статуса лидера
    - `release(): Promise<void>` - Освобождение лидерства

## Лучшие практики
- Всегда настраивайте `leaseDuration` в 2-3 раза больше чем renewalInterval
- Используйте уникальные `lockId` для разных сервисов
- Мониторьте таблицу leader_lease

## Дополнительные настройки
- `jitterRange`: Разброс времени запросов (по умолчанию: 2000)
- `lockId`: Идентификатор блокировки (по умолчанию: 1)

## Логика работы
1. Инициализация
  - Создание таблицы:
    При старте проверяется существование таблицы `leader_lease`. Если таблицы нет, она создается с полями:
    - `id` (идентификатор блокировки)
    - `leader_id` (уникальный идентификатор узла)
    - `expires_at` (время истечения аренды)
    - `created_at` (время создания записи)

  - Индексы и ограничения:
    Создается индекс для быстрого поиска по `expires_at` и CHECK-ограничение, гарантирующее корректность временных меток.

2. Механизм аренды (Lease)
- Захват лидерства:
  - Узел пытается вставить новую запись с `expires_at = NOW() + leaseDuration`.
  - Если запись уже существует:
    - Проверяет, не истекла ли текущая аренда `(expires_at < NOW())`.
    - Если аренда истекла, атомарно обновляет запись, устанавливая свой `leader_id` и новый `expires_at`.

3. Продление лидерства
  - Периодическое обновление:
    - Текущий лидер обновляет `expires_at` каждые `renewalInterval (± jitter)`, чтобы продлить аренду.

  - Jitter-механизм:
    - Случайная задержка (±2 сек по умолчанию) между попытками, чтобы избежать синхронизации запросов от разных узлов.

4. Освобождение лидерства
    - Явный вызов `release()`:
    Удаляет запись с текущим `leader_id`.

  - Автоматическое освобождение:
  Если лидер не успел продлить аренду, через `leaseDuration` другие узлы автоматически захватят лидерство.

5. Очистка устаревших записей
- Фоновая задача:
    Каждые` 6 × leaseDuration (± jitter)` удаляет записи, где `expires_at < NOW() - 5 sec`.
- Цель: Предотвращение накопления "мертвых" записей при нештатных сценариях.
