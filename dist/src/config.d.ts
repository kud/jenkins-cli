export declare const CONFIG_FILE: string;
interface ServerEntry {
    url?: string;
    user?: string;
    token?: string;
}
export interface StoredConfig {
    url?: string;
    user?: string;
    token?: string;
    current?: string;
    servers?: Record<string, ServerEntry>;
    __replaceServers?: boolean;
}
interface ResolveOverrides {
    url?: string;
    user?: string;
    token?: string;
    server?: string;
    timeout?: number;
    retries?: number;
}
export declare const loadConfig: () => StoredConfig;
export declare const saveConfig: (cfg: Partial<StoredConfig> & {
    __replaceServers?: boolean;
}) => void;
export declare const resolveConfig: (overrides?: ResolveOverrides) => StoredConfig;
export declare const addServer: (name: any, { url, user, token }: {
    url: any;
    user: any;
    token: any;
}) => void;
export declare const useServer: (name: any) => void;
export declare const removeServer: (name: any) => void;
export declare const listServers: () => {
    current: boolean;
    url?: string;
    user?: string;
    token?: string;
    name: string;
}[];
export {};
