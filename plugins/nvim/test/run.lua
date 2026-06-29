-- Headless integration test for mid.nvim (fences mode + spans, cursor mirror).
-- Run from repo root:  nvim --headless -u plugins/nvim/test/run.lua
-- Exits 0 on success, 1 on failure.

local function fail(msg)
  io.stderr:write("FAIL: " .. msg .. "\n")
  vim.cmd("cquit 1")
end

local repo = vim.fn.getcwd()
vim.opt.runtimepath:prepend(repo .. "/plugins/nvim")

local mid = require("mid")
mid.setup({ cmd = { "bun", "run", repo .. "/src/cli.ts" } }) -- no prebuilt binary needed

local ns = vim.api.nvim_get_namespaces()["mid"]

local function set_buf(lines)
  local buf = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_set_current_buf(buf)
  vim.bo[buf].filetype = "markdown"
  mid.attach(buf)
  return buf
end

local function marks(buf)
  return vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })
end

local function graph_text(buf)
  for _, m in ipairs(marks(buf)) do
    local d = m[4] or {}
    if d.virt_lines then
      local t = {}
      for _, vl in ipairs(d.virt_lines) do
        for _, ch in ipairs(vl) do
          t[#t + 1] = ch[1]
        end
      end
      return table.concat(t, "")
    end
  end
  return ""
end

-- a node's name appears highlighted (MidSelected) in the graph virt_lines
local function selected_is(buf, name)
  for _, m in ipairs(marks(buf)) do
    local d = m[4] or {}
    if d.virt_lines then
      for _, vline in ipairs(d.virt_lines) do
        for _, chunk in ipairs(vline) do
          if chunk[2] == "MidSelected" and chunk[1]:find(name, 1, true) then
            return true
          end
        end
      end
    end
  end
  return false
end

local function highlight_for(buf, row, col)
  vim.api.nvim_win_set_cursor(0, { row, col })
  mid.on_cursor(buf)
end

------------------------------------------------------------------- markdown ---
local buf = set_buf({
  "# notes",
  "",
  "```mid",
  "- A",
  "  - [first step](B)",
  "  - C",
  "```",
  "",
  "some prose",
})

if not ns then
  fail("mid namespace not created")
end

-- graph drawn + exactly the two fence lines concealed (bullets stay visible)
local ok = vim.wait(5000, function()
  local has_graph, conceals = false, 0
  for _, m in ipairs(marks(buf)) do
    local d = m[4] or {}
    if d.virt_lines and #d.virt_lines > 0 then
      has_graph = true
    end
    if d.conceal_lines ~= nil then
      conceals = conceals + 1
    end
  end
  return has_graph and conceals == 2
end, 50)
if not ok then
  fail("expected a graph extmark and the two fence lines concealed")
end

local concealed = {}
for _, m in ipairs(marks(buf)) do
  if (m[4] or {}).conceal_lines ~= nil then
    concealed[m[2]] = true
  end
end
if not (concealed[2] and concealed[6]) then
  fail("expected fence rows 2 and 6 concealed")
end
if concealed[3] or concealed[4] or concealed[5] then
  fail("bullet lines should stay visible")
end
io.stdout:write("OK: graph drawn, only the two fence lines concealed\n")

-- cursor mirror: moving onto each bullet highlights its node
highlight_for(buf, 4, 0) -- "- A"
if not vim.wait(2000, function()
  return selected_is(buf, "A")
end, 20) then
  fail("cursor on '- A' did not highlight A")
end
highlight_for(buf, 5, 4) -- "  - [first step](B)"  (B is the node)
if
  not vim.wait(1000, function()
    return selected_is(buf, "B") and not selected_is(buf, "A")
  end, 20)
then
  fail("cursor on the link bullet did not highlight B")
end
io.stdout:write("OK: cursor mirror highlights the node on each line\n")

-- LIVE EDIT: rename A -> Zeta on line 4; the graph must update (no flash bug)
vim.api.nvim_buf_set_lines(buf, 3, 4, false, { "- Zeta" })
if not vim.wait(5000, function()
  return graph_text(buf):find("Zeta") ~= nil
end, 50) then
  fail("live edit not applied: graph never showed 'Zeta'")
end
io.stdout:write("OK: live edit applied (graph re-rendered to 'Zeta')\n")

-- moving onto the heading clears the highlight
highlight_for(buf, 1, 0)
if vim.wait(500, function()
  return not selected_is(buf, "Zeta")
end, 20) == false then
  fail("highlight not cleared off-node")
end
io.stdout:write("OK: highlight cleared off-node\n")

-------------------------------------------------------------------- mermaid ---
-- Start and Parse share source line 3 (`A[Start] --> B[Parse]`); the cursor
-- COLUMN must disambiguate which node highlights (spans, issue #3).
local mbuf = set_buf({
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[Parse]",
  "  B --> C[Done]",
  "```",
})
if not vim.wait(5000, function()
  return graph_text(mbuf):find("Start") ~= nil
end, 50) then
  fail("mermaid graph never rendered")
end
highlight_for(mbuf, 3, 2) -- on the `A` id
if not vim.wait(1000, function()
  return selected_is(mbuf, "Start")
end, 20) then
  fail("mermaid: cursor on 'A' did not highlight Start")
end
highlight_for(mbuf, 3, 15) -- on the `B` id, same line
if
  not vim.wait(1000, function()
    return selected_is(mbuf, "Parse") and not selected_is(mbuf, "Start")
  end, 20)
then
  fail("mermaid: cursor column did not disambiguate Parse on the shared line")
end
highlight_for(mbuf, 4, 2) -- on the `B` id on the next line → still Parse
if not vim.wait(1000, function()
  return selected_is(mbuf, "Parse")
end, 20) then
  fail("mermaid: B's second occurrence did not highlight Parse")
end
io.stdout:write("OK: mermaid cursor-column disambiguation highlights the right node\n")

vim.cmd("qall!")
