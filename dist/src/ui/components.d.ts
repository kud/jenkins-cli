import type { ReactNode } from "react";
export declare const windowStart: (selected: number, total: number, rows: number) => number;
interface PanelProps {
    title: string;
    color: string;
    focused: boolean;
    width?: number;
    height?: number;
    flexGrow?: number;
    children: ReactNode;
}
export declare const Panel: ({ title, color, focused, width, height, flexGrow, children, }: PanelProps) => import("react").JSX.Element;
interface ScrollListProps {
    items: string[];
    selected: number;
    rows: number;
    emptyText: string;
}
export declare const ScrollList: ({ items, selected, rows, emptyText, }: ScrollListProps) => import("react").JSX.Element;
export declare const LogView: ({ lines }: {
    lines: string[];
}) => import("react").JSX.Element;
export declare const StatusBar: ({ content, width, }: {
    content: string;
    width: number;
}) => import("react").JSX.Element;
export declare const Overlay: ({ title, color, width, height, children, }: {
    title: string;
    color: string;
    width: number;
    height: number;
    children: ReactNode;
}) => import("react").JSX.Element;
export {};
