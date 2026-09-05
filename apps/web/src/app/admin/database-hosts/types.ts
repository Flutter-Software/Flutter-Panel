export type DatabaseHostRecord = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  passwordSet: boolean;
  publicHost: string;
  publicPort: number;
  nodeIds: string[];
  nodeNames: string[];
  maxDatabases: number;
  databaseCount: number;
  endpoint: { host: string; port: number };
  createdAt: string;
};
