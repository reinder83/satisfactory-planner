// Entry point. The event modules register document-level listeners as a side effect;
// they are imported in the order the listeners must be registered.
import { boot } from './app/session.js';
import './app/events/views.js';
import './app/events/profiles.js';
import './app/events/backup.js';

boot();
