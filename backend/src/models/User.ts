import { knex } from '../config/database';

interface User {
  id: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
}

export const createUser = async (user: Omit<User, 'id'>) => {
  return knex('users').insert(user);
};

export const findUserByEmail = async (email: string) => {
  return knex<User>('users').where({ email }).first();
};