export default {
  meta: { name: "mid" },
  rules: {
    "no-comments": {
      meta: { fixable: "code" },
      create(context) {
        const text = context.sourceCode.text;
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.type === "Shebang") continue;
              let [start, end] = comment.range;
              const lineStart = text.lastIndexOf("\n", start - 1) + 1;
              const nl = text.indexOf("\n", end);
              const lineEnd = nl === -1 ? text.length : nl;
              if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
                start = lineStart;
                end = nl === -1 ? lineEnd : nl + 1;
              } else {
                while (start > lineStart && /[ \t]/.test(text[start - 1])) start--;
              }
              context.report({
                node: comment,
                message: "Comments are not allowed.",
                fix: (fixer) => fixer.removeRange([start, end]),
              });
            }
          },
        };
      },
    },
  },
};
