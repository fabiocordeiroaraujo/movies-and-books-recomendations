import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('reports a healthy service', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ status: 'ok', service: 'movies-and-books-api' });
  });

  it('loads movies and books from the existing catalog', async () => {
    const movies = await request(app.getHttpServer())
      .get('/movies?page=1&pageSize=2')
      .expect(200);
    const books = await request(app.getHttpServer())
      .get('/books?page=1&pageSize=2')
      .expect(200);

    expect(movies.body.items).toHaveLength(2);
    expect(movies.body.total).toBeGreaterThan(0);
    expect(movies.body.items[0].type).toBe('MOVIE');
    expect(books.body.items).toHaveLength(2);
    expect(books.body.total).toBeGreaterThan(0);
    expect(books.body.items[0].type).toBe('BOOK');
  });

  it('returns recommendation status and a user-safe fallback', async () => {
    const status = await request(app.getHttpServer())
      .get('/recommendation/status')
      .expect(200);
    expect(status.body).toHaveProperty('available');
    expect(status.body).toHaveProperty('neuralModelActive');

    const users = await request(app.getHttpServer()).get('/users').expect(200);
    expect(users.body.length).toBeGreaterThan(0);
    const userId = users.body[0].id as number;
    const recommendations = await request(app.getHttpServer())
      .get(`/users/${userId}/recommendations?type=MOVIE&limit=3`)
      .expect(200);
    const summary = await request(app.getHttpServer())
      .get(`/users/${userId}/preference-summary`)
      .expect(200);

    expect(recommendations.body.items.length).toBeLessThanOrEqual(3);
    expect(recommendations.body).toHaveProperty('strategy');
    expect(recommendations.body).toHaveProperty('modelVersion');
    expect(summary.body.user.id).toBe(userId);
    expect(summary.body.taste).toHaveProperty('likeCount');
    expect(summary.body).not.toHaveProperty('embedding');

    const ignoredInteraction = await request(app.getHttpServer())
      .post(`/users/${userId}/interactions`)
      .send({
        events: [
          {
            eventType: 'IMPRESSION',
            itemType: 'MOVIE',
            itemId: 999_999_999,
          },
        ],
      })
      .expect(201);
    expect(ignoredInteraction.body).toEqual({ accepted: 0 });
  });

  afterEach(async () => {
    await app.close();
  });
});
