export interface LogLine {
    number: number;
    raw: string;
    level: string | null;
}
export declare const cleanLogContent: (content: string) => string;
export declare const extractLogLevel: (line: string) => string | null;
export declare const processLog: (content: string) => LogLine[];
export declare const highlightMatches: (raw: string, query: string) => string;
export interface RenderLineOpts {
    showLineNumbers: boolean;
    bookmarked: boolean;
    searchQuery?: string | null;
}
export declare const renderLogLine: (line: LogLine, opts: RenderLineOpts) => string;
export declare const findMatchingLines: (lines: LogLine[], query: string) => number[];
export declare const firstLineOfLevel: (lines: LogLine[], level: string, from?: number) => number;
