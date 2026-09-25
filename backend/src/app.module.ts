import { Module } from '@nestjs/common';
import { CatalogController } from './api/controllers/catalog.controller.js';
import { PreferencesController } from './api/controllers/preferences.controller.js';
import { UsersController } from './api/controllers/users.controller.js';
import { RecommendationsController } from './api/controllers/recommendations.controller.js';
import { CatalogUseCases } from './application/use-cases/catalog.use-cases.js';
import { PreferenceUseCases } from './application/use-cases/preference.use-cases.js';
import { UserUseCases } from './application/use-cases/user.use-cases.js';
import { RecommendationUseCases } from './application/use-cases/recommendation.use-cases.js';
import { AppController } from './app.controller.js';
import { CatalogRepository } from './domain/repositories/catalog.repository.js';
import { PreferenceRepository } from './domain/repositories/preference.repository.js';
import { UserRepository } from './domain/repositories/user.repository.js';
import { RecommendationRepository } from './domain/repositories/recommendation.repository.js';
import { DatabaseService } from './infrastructure/database/database.service.js';
import { PostgresCatalogRepository } from './infrastructure/repositories/postgres-catalog.repository.js';
import { PostgresPreferenceRepository } from './infrastructure/repositories/postgres-preference.repository.js';
import { PostgresUserRepository } from './infrastructure/repositories/postgres-user.repository.js';
import { PostgresRecommendationRepository } from './infrastructure/repositories/postgres-recommendation.repository.js';
import { RecommendationMetricsInterceptor } from './api/recommendation-metrics.interceptor.js';

@Module({
  imports: [],
  controllers: [
    AppController,
    CatalogController,
    UsersController,
    PreferencesController,
    RecommendationsController,
  ],
  providers: [
    DatabaseService,
    CatalogUseCases,
    UserUseCases,
    PreferenceUseCases,
    RecommendationUseCases,
    RecommendationMetricsInterceptor,
    { provide: CatalogRepository, useClass: PostgresCatalogRepository },
    { provide: UserRepository, useClass: PostgresUserRepository },
    { provide: PreferenceRepository, useClass: PostgresPreferenceRepository },
    {
      provide: RecommendationRepository,
      useClass: PostgresRecommendationRepository,
    },
  ],
})
export class AppModule {}
