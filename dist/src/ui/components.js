import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import chalk from "chalk";
// Compute the window start so the selected row stays visible (centred when possible).
export const windowStart = (selected, total, rows) => {
    if (total <= rows)
        return 0;
    const start = selected - Math.floor(rows / 2);
    return Math.max(0, Math.min(start, total - rows));
};
// A bordered pane with a coloured title header. Border brightens and the title
// gains a ● marker when focused — the Ink equivalent of blessed's active labels.
export const Panel = ({ title, color, focused, width, height, flexGrow, children, }) => (_jsxs(Box, { flexDirection: "column", width: width, height: height, flexGrow: flexGrow, borderStyle: "round", borderColor: focused ? color : "gray", overflow: "hidden", children: [_jsx(Text, { color: focused ? color : "gray", bold: true, children: focused ? `${title} ●` : title }), children] }));
// A vertically-windowed selectable list. Selection is shown via reverse video,
// which survives chalk-coloured item strings (colour resets don't clear [7m).
export const ScrollList = ({ items, selected, rows, emptyText, }) => {
    if (!items.length)
        return _jsx(Text, { color: "gray", children: emptyText });
    const start = windowStart(selected, items.length, Math.max(1, rows));
    const visible = items.slice(start, start + Math.max(1, rows));
    return (_jsx(Box, { flexDirection: "column", children: visible.map((it, i) => {
            const idx = start + i;
            const line = idx === selected ? chalk.inverse(` ${it}`) : `  ${it}`;
            return (_jsx(Text, { wrap: "truncate", children: line }, idx));
        }) }));
};
// A dumb log viewport — App pre-renders the visible slice (already chalk-formatted)
// so this component only lays lines out.
export const LogView = ({ lines }) => (_jsx(Box, { flexDirection: "column", children: lines.map((l, i) => (_jsx(Text, { wrap: "truncate", children: l.length ? l : " " }, i))) }));
// Full-width bottom bar. Content is a pre-built chalk string.
export const StatusBar = ({ content, width, }) => (_jsx(Box, { width: width, borderStyle: "round", borderColor: "green", height: 3, children: _jsx(Text, { wrap: "truncate", children: content }) }));
// A centred overlay that replaces the body (help / artifacts). Simpler and more
// robust in Ink than a floating popup, and reads the same to the user.
export const Overlay = ({ title, color, width, height, children, }) => (_jsx(Box, { width: width, height: height, justifyContent: "center", alignItems: "center", children: _jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: color, paddingX: 1, width: Math.min(width - 4, 100), children: [_jsx(Text, { color: color, bold: true, children: title }), children] }) }));
