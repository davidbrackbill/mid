-- mid.nvim — render ```mid (and ```mermaid) fenced blocks as inline graphs.
--
-- Independent of render-markdown.nvim: own extmark namespace, scoped to fenced
-- blocks. Imports nothing from the editor side of mid — it shells out to the
-- `mid` CLI (async, debounced) once per block and consumes the JSON contract.
--
-- Modes (`config.mode`):
--   "fences" (default) — conceal only the ``` fence lines (nvim 0.11
--       `conceal_lines`); the bullet source stays visible and editable, and the
--       graph is drawn as `virt_lines` *above* the first content line.
--   "inline" — source untouched, graph drawn as virt_lines below the block.
--
-- Interaction is just the cursor mirror: nav is ordinary motion, and wherever
-- the cursor lands the node on that line is highlighted in the graph (`cell`
-- rectangle + per-node source `spans` for the cursor→node mapping). No special
-- keymaps — moving through the source walks the graph; editing updates it live.
--
-- Rendering is incremental: on edit we reconcile blocks and update extmarks in
-- place by id (never a blanket namespace clear), so the source doesn't flash.

local M = {}

local config = {
  cmd = { "mid" }, -- how to invoke the CLI (override for dev)
  languages = { mid = "md", mermaid = "mmd" }, -- info string -> mid --format
  filetypes = { "markdown" },
  mode = "fences", -- "fences" | "inline"
  click = true, -- click a graph node (mouse) to jump to its source line
  debounce = 120, -- ms after an edit before re-rendering
  select_debounce = 20, -- ms after cursor move before re-highlighting
  hl = "MidGraph",
  hl_selected = "MidSelected",
}

local ns = vim.api.nvim_create_namespace("mid")
local state = {} -- buf -> { blocks, attached, warned, timers }

-- Resolve the default CLI: prefer the prebuilt binary the `build` hook drops in
-- the plugin's own `bin/` (so install needs no PATH setup), else fall back to a
-- `mid` on PATH. An explicit `cmd` in setup() always wins over this.
local function bundled_cmd()
  local src = debug.getinfo(1, "S").source:sub(2) -- .../lua/mid/init.lua
  local bin = vim.fn.fnamemodify(src, ":h:h:h") .. "/bin/mid"
  if vim.fn.executable(bin) == 1 then
    return { bin }
  end
  return { "mid" }
end

local function buf_state(buf)
  state[buf] = state[buf] or { blocks = {}, timers = {}, warned = false }
  return state[buf]
end

local function debounce(buf, kind, ms, fn)
  local st = buf_state(buf)
  local t = st.timers[kind]
  if t then
    t:stop()
    if not t:is_closing() then
      t:close()
    end
  end
  t = vim.uv.new_timer()
  st.timers[kind] = t
  t:start(ms, 0, function()
    vim.schedule(fn)
  end)
end

local function set_conceal(buf)
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    vim.api.nvim_set_option_value("conceallevel", 2, { win = win })
    vim.api.nvim_set_option_value("concealcursor", "", { win = win })
  end
end

-- Find fenced code blocks whose info string is a configured language.
-- Returns { { open, close, lang, content, text }, ... } with 1-indexed lines.
local function find_blocks(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local blocks = {}
  local i = 1
  while i <= #lines do
    local lang = lines[i]:match("^%s*```%s*([%w_-]+)%s*$")
    if lang and config.languages[lang] then
      local close
      for j = i + 1, #lines do
        if lines[j]:match("^%s*```%s*$") then
          close = j
          break
        end
      end
      if close then
        local content = {}
        for j = i + 1, close - 1 do
          content[#content + 1] = lines[j]
        end
        blocks[#blocks + 1] = {
          open = i,
          close = close,
          lang = lang,
          content = content,
          text = table.concat(content, "\n"),
        }
        i = close + 1
      else
        i = i + 1
      end
    else
      i = i + 1
    end
  end
  return blocks
end

-- Build virt_lines for the graph, recoloring the selected cell (a node box or an
-- edge label — `block.sel_cell` is set by on_cursor to whichever the cursor is on).
local function build_virt(block)
  local sel = block.sel_cell

  local virt = {}
  for idx, line in ipairs(block.ascii_lines or {}) do
    local r = idx - 1 -- 0-indexed grid row
    if sel and r >= sel.row and r < sel.row + sel.height then
      local chars = vim.fn.split(line, "\\zs") -- UTF-8 aware
      local n = #chars
      local a = math.min(sel.col, n)
      local b = math.min(sel.col + sel.width, n)
      local pre = table.concat(vim.list_slice(chars, 1, a), "")
      local mid = table.concat(vim.list_slice(chars, a + 1, b), "")
      local post = table.concat(vim.list_slice(chars, b + 1, n), "")
      local chunks = {}
      if #pre > 0 then
        chunks[#chunks + 1] = { pre, config.hl }
      end
      if #mid > 0 then
        chunks[#chunks + 1] = { mid, config.hl_selected }
      end
      if #post > 0 then
        chunks[#chunks + 1] = { post, config.hl }
      end
      virt[idx] = #chunks > 0 and chunks or { { "", config.hl } }
    else
      virt[idx] = { { line, config.hl } }
    end
  end
  return virt
end

-- 0-indexed row the graph's virt_lines anchor on, and whether they go above it.
-- "fences": above the first content line (a visible, non-concealed anchor).
-- "inline": below the closing fence.
local function anchor(block)
  if config.mode == "inline" then
    return block.close - 1, false
  end
  return block.open, true -- block.open (1-idx fence) == 0-idx first content line
end

-- Draw / update the graph mark and (in fences mode) the fence-conceal marks,
-- reusing stored extmark ids so edits update in place — no flash, no clear.
local function draw_block(buf, block)
  if not block.ascii_lines then
    return
  end
  local row, above = anchor(block)
  block.mark = vim.api.nvim_buf_set_extmark(buf, ns, row, 0, {
    id = block.mark,
    virt_lines = build_virt(block),
    virt_lines_above = above,
  })
  if config.mode == "fences" then
    block.conceal_open = vim.api.nvim_buf_set_extmark(buf, ns, block.open - 1, 0, {
      id = block.conceal_open,
      conceal_lines = "",
    })
    block.conceal_close = vim.api.nvim_buf_set_extmark(buf, ns, block.close - 1, 0, {
      id = block.conceal_close,
      conceal_lines = "",
    })
  end
end

local function del_marks(buf, block)
  for _, key in ipairs({ "mark", "conceal_open", "conceal_close" }) do
    if block[key] then
      pcall(vim.api.nvim_buf_del_extmark, buf, ns, block[key])
      block[key] = nil
    end
  end
end

-- Run mid on one block, store its data, then draw (updating marks in place).
local function render_block(buf, block)
  if #block.content == 0 then
    return
  end
  local fmt = config.languages[block.lang]
  local cmd = vim.deepcopy(config.cmd)
  vim.list_extend(cmd, { "render", "--json", "--format", fmt, "-" })

  local st = buf_state(buf)
  local ok, err = pcall(function()
    vim.system(cmd, { stdin = block.text, text = true }, function(res)
      vim.schedule(function()
        if not vim.api.nvim_buf_is_valid(buf) then
          return
        end
        -- ignore stale callbacks for a block that's been reconciled away
        if not vim.tbl_contains(st.blocks, block) then
          return
        end
        if res.code ~= 0 then
          if not st.warned then
            st.warned = true
            vim.notify("[mid] render failed: " .. (res.stderr or "?"), vim.log.levels.WARN)
          end
          return
        end
        st.warned = false
        local data = vim.json.decode(res.stdout)

        block.nodes = data.nodes or {}
        block.edges = data.edges or {}
        block.ascii_lines = vim.split(data.ascii or "", "\n", { plain = true })
        -- buffer line -> list of { col, len, cell } tokens on it, from every node's
        -- and labeled edge's spans. A line may carry several tokens (a mermaid
        -- `A -->|x| B` has two node ids + the label; a mid `[x](t)` has the label +
        -- target); the cursor column disambiguates. `cell` is the rectangle to
        -- highlight (the node box, or the edge's label). mid and mermaid identical.
        block.line_tokens = {}
        local function add_tok(sp, cell, is_node)
          local row = block.open + sp.line
          local l = block.line_tokens[row]
          if not l then
            l = {}
            block.line_tokens[row] = l
          end
          l[#l + 1] = { col = sp.col, len = sp.len, cell = cell, is_node = is_node }
        end
        for _, node in ipairs(block.nodes) do
          for _, sp in ipairs(node.spans or {}) do
            add_tok(sp, node.cell, true)
          end
        end
        for _, edge in ipairs(block.edges) do
          for _, sp in ipairs(edge.spans or {}) do
            add_tok(sp, edge.cell, false)
          end
        end
        draw_block(buf, block)
        M.on_cursor(buf) -- pick up the node under the cursor if we're in this block
      end)
    end)
  end)
  if not ok and not st.warned then
    st.warned = true
    vim.notify(
      "[mid] could not run `"
        .. config.cmd[1]
        .. "` ("
        .. tostring(err)
        .. "). Re-run the install hook (`:Lazy build mid.nvim`) to fetch the prebuilt binary, "
        .. "put a `mid` on PATH, or set require('mid').setup{ cmd = ... }.",
      vim.log.levels.ERROR
    )
  end
end

-- Reconcile the buffer's blocks against the previous render, updating marks in
-- place. Carries cached renders across edits and only re-spawns mid for blocks
-- whose content actually changed — so typing doesn't clear or flash the graph.
local function reconcile(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  local st = buf_state(buf)
  local old = st.blocks -- snapshot; `new` becomes the published list below
  local new = find_blocks(buf)

  -- blocks that no longer exist: remove their marks
  for i = #new + 1, #old do
    del_marks(buf, old[i])
  end

  -- carry each new block's prior render + mark ids forward (matched by index),
  -- BEFORE publishing — so `old[i]` still refers to the genuine previous block.
  for i, nb in ipairs(new) do
    local ob = old[i]
    if ob then
      nb.mark, nb.conceal_open, nb.conceal_close = ob.mark, ob.conceal_open, ob.conceal_close
      nb.nodes, nb.edges, nb.ascii_lines = ob.nodes, ob.edges, ob.ascii_lines
      nb.line_tokens, nb.sel_cell = ob.line_tokens, ob.sel_cell
    end
  end
  st.blocks = new -- publish (a fresh table; `old` is untouched)

  for i, nb in ipairs(new) do
    local ob = old[i]
    -- reposition the carried graph + conceal marks synchronously: fence lines
    -- render instantly, so there's no flash while mid re-runs in the background.
    if nb.ascii_lines then
      draw_block(buf, nb)
    end
    -- re-run the CLI only when the content actually changed (or it's new)
    if not ob or ob.text ~= nb.text or not nb.ascii_lines then
      render_block(buf, nb)
    end
  end
end

-- Re-scan and render every block from scratch (initial attach only).
local function full_render(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  local st = buf_state(buf)
  st.blocks = find_blocks(buf)
  for _, block in ipairs(st.blocks) do
    render_block(buf, block)
  end
end

-- Which token's `cell` is at (row, col)? Most lines carry one token; a line with
-- several (a mermaid `A -->|x| B`, or a mid `[label](target)`) is disambiguated by
-- the cursor column — the token whose `[col,col+len)` contains it, else the nearest.
-- Returns the cell to highlight (a node box or an edge label), or nil.
local function cell_at(block, row, col)
  local list = block.line_tokens and block.line_tokens[row]
  if not list or #list == 0 then
    return nil
  end
  -- a token that actually contains the cursor wins (so on a label → the edge)
  for _, e in ipairs(list) do
    if col >= e.col and col < e.col + e.len then
      return e.cell
    end
  end
  -- otherwise prefer the nearest *node* (the line's destination), then any token
  local best, bestd
  for _, e in ipairs(list) do
    if e.is_node then
      local d = math.min(math.abs(col - e.col), math.abs(col - (e.col + e.len)))
      if not bestd or d < bestd then
        best, bestd = e.cell, d
      end
    end
  end
  if best then
    return best
  end
  for _, e in ipairs(list) do
    local d = math.min(math.abs(col - e.col), math.abs(col - (e.col + e.len)))
    if not bestd or d < bestd then
      best, bestd = e.cell, d
    end
  end
  return best
end

-- Highlight whatever is under the cursor (client-side recolor, no subprocess). Nav
-- is ordinary cursor motion: on a node name → its box; on an edge label → that edge.
-- (cell_at returns the *stored* cell table, so `~=` correctly detects a change.)
function M.on_cursor(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  local pos = vim.api.nvim_win_get_cursor(0)
  local row, col = pos[1], pos[2]
  for _, block in ipairs(buf_state(buf).blocks) do
    local sel
    if row > block.open and row < block.close then
      sel = cell_at(block, row, col)
    end
    if sel ~= block.sel_cell then
      block.sel_cell = sel
      if block.ascii_lines then
        draw_block(buf, block)
      end
    end
  end
end

-- Map a mouse position to a node box or edge label in some block's graph. The
-- graph is drawn as virt_lines, so we work in screen coordinates: anchor on the
-- screen row/col of a known buffer line (the first content line in "fences" mode,
-- the closing fence in "inline"), derive the clicked (grid row, grid col), then find
-- the node/edge whose `cell` contains it. Returns block, spans (its source spans),
-- or nil. Assumes the block isn't wrapped/folded — good enough for the common case.
local function target_at_mouse(buf, m)
  local win = m.winid
  if win == 0 then
    return nil
  end
  local function inside(grow, gcol, c)
    return c
      and grow >= c.row
      and grow < c.row + c.height
      and gcol >= c.col
      and gcol < c.col + c.width
  end
  for _, block in ipairs(buf_state(buf).blocks) do
    if block.ascii_lines and block.nodes then
      local n = #block.ascii_lines
      local top, anchor
      if config.mode == "inline" then
        anchor = vim.fn.screenpos(win, block.close, 1) -- closing fence line
        top = anchor.row > 0 and anchor.row + 1 or 0 -- graph sits just below it
      else
        anchor = vim.fn.screenpos(win, block.open + 1, 1) -- first content line
        top = anchor.row > 0 and anchor.row - n or 0 -- graph sits just above it
      end
      if anchor.row > 0 then
        local grow = m.screenrow - top -- 0-indexed graph row
        local gcol = m.screencol - anchor.col -- 0-indexed grid column
        if grow >= 0 and grow < n and gcol >= 0 then
          for _, node in ipairs(block.nodes) do
            if inside(grow, gcol, node.cell) then
              return block, node.spans
            end
          end
          for _, edge in ipairs(block.edges or {}) do
            if inside(grow, gcol, edge.cell) then
              return block, edge.spans
            end
          end
        end
      end
    end
  end
  return nil
end

-- Click a node box or edge label in the graph → jump the cursor to its source
-- (spans[0]); the cursor mirror then highlights it. Bound to <LeftRelease> so normal
-- <LeftMouse> positioning still happens — we only *add* the jump on a graph hit.
function M.on_click(buf)
  buf = buf or vim.api.nvim_get_current_buf()
  if not state[buf] then
    return
  end
  local m = vim.fn.getmousepos()
  local block, spans = target_at_mouse(buf, m)
  if not (block and spans and spans[1]) then
    return
  end
  local sp = spans[1]
  pcall(
    vim.api.nvim_win_set_cursor,
    m.winid ~= 0 and m.winid or 0,
    { block.open + sp.line, sp.col }
  )
end

function M.attach(buf)
  local st = buf_state(buf)
  if st.attached then
    return
  end
  st.attached = true

  set_conceal(buf)

  -- Incremental re-render on the exact changed range (no full clear → no flash).
  vim.api.nvim_buf_attach(buf, false, {
    on_lines = function()
      if not state[buf] then
        return true
      end -- detached
      debounce(buf, "render", config.debounce, function()
        reconcile(buf)
      end)
    end,
  })

  local grp = vim.api.nvim_create_augroup("mid.buf." .. buf, { clear = true })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = grp,
    buffer = buf,
    callback = function()
      debounce(buf, "select", config.select_debounce, function()
        M.on_cursor(buf)
      end)
    end,
  })
  vim.api.nvim_create_autocmd({ "BufWinEnter", "WinEnter" }, {
    group = grp,
    buffer = buf,
    callback = function()
      set_conceal(buf)
    end,
  })
  vim.api.nvim_create_autocmd("BufUnload", {
    group = grp,
    buffer = buf,
    callback = function()
      state[buf] = nil
    end,
  })

  -- <LeftRelease> fires after the default <LeftMouse> positioning, so this only
  -- *adds* graph-click → jump-to-source (and no-ops for clicks off the graph).
  if config.click then
    vim.keymap.set({ "n", "i" }, "<LeftRelease>", function()
      M.on_click(buf)
    end, { buffer = buf, desc = "mid: jump to clicked node's source" })
  end

  full_render(buf)
end

function M.refresh()
  full_render(vim.api.nvim_get_current_buf())
end

-- MidGraph: the graph uses Comment's *colour* but always a regular font — Comment
-- is italic in most colorschemes and an italic ASCII graph reads badly, so we copy
-- the colour (not the link) and no style attrs carry over.
-- MidSelected: the focused node is shown **bold** (its box border + text) rather
-- than with a background highlight — `bold` with the default (Normal) foreground so
-- it stands out from the dimmed graph. Re-derived on ColorScheme to track the theme.
local function set_highlights()
  local c = vim.api.nvim_get_hl(0, { name = "Comment", link = false })
  vim.api.nvim_set_hl(0, "MidGraph", { fg = c.fg, ctermfg = c.ctermfg, default = true })
  vim.api.nvim_set_hl(0, "MidSelected", { bold = true, default = true })
end

function M.setup(opts)
  opts = opts or {}
  config = vim.tbl_deep_extend("force", config, opts)
  if not opts.cmd then
    config.cmd = bundled_cmd()
  end
  set_highlights()

  local grp = vim.api.nvim_create_augroup("mid", { clear = true })
  vim.api.nvim_create_autocmd("ColorScheme", { group = grp, callback = set_highlights })
  vim.api.nvim_create_autocmd("FileType", {
    group = grp,
    pattern = config.filetypes,
    callback = function(a)
      M.attach(a.buf)
    end,
  })
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if
      vim.api.nvim_buf_is_loaded(buf)
      and vim.tbl_contains(config.filetypes, vim.bo[buf].filetype)
    then
      M.attach(buf)
    end
  end
end

return M
