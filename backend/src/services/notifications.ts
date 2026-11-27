// In-app notification adapter. An email or SMS adapter can implement the same interface.
import { query, type Db } from '../lib/db.js';

export interface NotificationMessage { userId: string; applicationId: string; title: string; message: string; link: string }
export interface NotificationAdapter { send(db: Db, message: NotificationMessage): Promise<void> }

export const notifier: NotificationAdapter = {
  async send(db, m) {
    await query(
      db,
      'INSERT INTO notifications (user_id, application_id, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [m.userId, m.applicationId, m.title, m.message, m.link],
    );
  },
};
