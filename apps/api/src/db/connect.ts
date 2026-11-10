import mongoose from 'mongoose';

let connected = false;

export interface ConnectOptions {
  uri: string;
  dbName?: string;
  autoIndex?: boolean;
}

export async function connectDB(options: ConnectOptions): Promise<typeof mongoose> {
  if (connected) return mongoose;
  mongoose.set('strictQuery', true);
  await mongoose.connect(options.uri, {
    dbName: options.dbName,
    autoIndex: options.autoIndex ?? true,
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20,
  });
  connected = true;
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isDBConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}

export function getConnection() {
  return mongoose.connection;
}