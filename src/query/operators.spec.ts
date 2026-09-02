import { describe, expect, it } from 'vitest';
import { DatabaseException } from '../exceptions.js';
import { assertIdentifier, likeToRegExp, renderOrderBy, renderSelect, renderWhere } from './operators.js';

describe('renderWhere', () => {
  it('renders equality with $n params for postgres/memory', () => {
    expect(renderWhere('postgres', { name: 'x' })).toEqual({ text: 'name = $1', params: ['x'] });
    expect(renderWhere('memory', { name: 'x' })).toEqual({ text: 'name = $1', params: ['x'] });
  });

  it('uses ? placeholders for mysql', () => {
    expect(renderWhere('mysql', { name: 'x' })).toEqual({ text: 'name = ?', params: ['x'] });
  });

  it('renders comparison operators in order', () => {
    const out = renderWhere('postgres', {
      age: { $gte: 18, $lt: 65 },
      name: { $like: 'a%' },
      active: { $in: [true, false] },
      role: { $ne: 'guest' },
      deletedAt: { $isNull: true },
      score: { $between: [0, 10] },
    });
    expect(out).toEqual({
      text: 'age >= $1 AND age < $2 AND name LIKE $3 AND active IN ($4, $5) AND role != $6 AND deletedAt IS NULL AND score BETWEEN $7 AND $8',
      params: [18, 65, 'a%', true, false, 'guest', 0, 10],
    });
  });

  it('skips undefined values', () => {
    expect(renderWhere('postgres', { name: 'x', note: undefined })).toEqual({ text: 'name = $1', params: ['x'] });
  });

  it('renders IS NOT NULL and NOT IN', () => {
    expect(renderWhere('postgres', { a: { $isNull: false }, b: { $nin: [1, 2] } })).toEqual({
      text: 'a IS NOT NULL AND b NOT IN ($1, $2)',
      params: [1, 2],
    });
  });

  it('renders $not operator as NOT (...)', () => {
    const out = renderWhere('postgres', { age: { $not: { $gt: 65 } } });
    expect(out).toEqual({ text: 'NOT (age > $1)', params: [65] });
  });

  it('renders $not with $in operator', () => {
    const out = renderWhere('postgres', { role: { $not: { $in: ['admin', 'superadmin'] } } });
    expect(out).toEqual({ text: 'NOT (role IN ($1, $2))', params: ['admin', 'superadmin'] });
  });

  it('renders $not with $like operator on mysql', () => {
    const out = renderWhere('mysql', { name: { $not: { $like: '%test%' } } });
    expect(out).toEqual({ text: 'NOT (name LIKE ?)', params: ['%test%'] });
  });

  it('returns undefined for missing or empty filters', () => {
    expect(renderWhere('postgres', undefined)).toBeUndefined();
    expect(renderWhere('postgres', {})).toBeUndefined();
  });

  it('throws DATABASE_INVALID_IDENTIFIER on unsafe field names', () => {
    expect(() => renderWhere('postgres', { 'bad name': 1 })).toThrow(/Invalid filter field/);
    expect(() => renderWhere('postgres', { 'x; DROP TABLE users': 1 })).toThrow(DatabaseException);
  });

  it('throws DATABASE_UNSUPPORTED_OPERATION on unknown operators', () => {
    expect(() => renderWhere('postgres', { a: { $bogus: 1 } })).toThrow(/Unsupported filter operator/);
  });
});

describe('renderOrderBy / renderSelect', () => {
  it('renders validated order columns', () => {
    expect(renderOrderBy({ name: 'asc', age: 'desc' })).toBe(' ORDER BY name ASC, age DESC');
  });

  it('rejects unsafe order columns', () => {
    expect(() => renderOrderBy({ 'x) y': 'asc' })).toThrow(DatabaseException);
  });

  it('renders projections and the default star', () => {
    expect(renderSelect(['id', 'name'])).toBe('id, name');
    expect(renderSelect(undefined)).toBe('*');
    expect(renderSelect([])).toBe('*');
  });
});

describe('assertIdentifier / likeToRegExp', () => {
  it('accepts alphanumeric/underscore identifiers only', () => {
    expect(() => assertIdentifier('user_name2')).not.toThrow();
    expect(() => assertIdentifier('user-name')).toThrow(DatabaseException);
    expect(() => assertIdentifier('123abc')).toThrow(DatabaseException);
  });

  it('converts LIKE patterns into anchored regexps', () => {
    expect(likeToRegExp('a%_b').source).toBe('^a.*.b$');
    expect(likeToRegExp('100%').test('100')).toBe(true);
    expect(likeToRegExp('100%').test('101')).toBe(false);
    expect(likeToRegExp('100%x').test('100abcx')).toBe(true);
  });
});