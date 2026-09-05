# Changelog

## 0.2.69

### Console

The command box suggests real commands for the server's egg as you type (Minecraft, Paper, Project Zomboid, Valheim, Palworld, Rust, ARK, Terraria, Source, FiveM). Tab or click to fill. Up and down move in the list while it is open; with an empty box they still walk history. Ctrl+Space shows the first suggestions with nothing typed.

## 0.2.68

### Dashboard

The server list fills CPU, RAM, and disk from the node (cached a few seconds, skipped when the node is down or the server is installing). Cards show a crash, a disk at 90%, or a node that missed its heartbeat, and those servers sort to the top. The same alerts show on the admin server list.

## 0.2.67

### Nodes

If UFW is already on, the node installer opens the daemon port and SFTP (2022 by default), not only 8080. Install commands use the node’s daemon port. The About page checks heartbeat, whether the panel can reach the daemon, whether this browser can, and whether the on-disk config matches the node’s ports. `/health` allows that browser check.

## 0.2.66

### Console

The log is still a React list, not xterm. Color codes from the process show as color. Up and down in the command box walk commands you already sent. Click a timestamp to copy that line. Select text for a Copy chip. All / Game / Flutter filters the buffer without hiding Flutter as a different stream.

## 0.2.65

### Files

Search filenames from the current folder. Paste `/home/container/...` or `sftp://` paths to jump to a file or folder. Copy path copies the container path. The editor can compare unsaved edits to the last saved version. Download sends a file to the browser, or a zip when you pick a folder or several items. Archive still leaves a `.tar.gz` on the server.

## 0.2.64

### Console

Install output is written on the node and comes back after a refresh. When a server dies, the console shows why: out of memory, stopped or killed from the panel, a crash with the exit code, or a failed install. Copy last 50 copies the visible lines without ANSI codes.

## 0.2.63

### Network

Allocations are no longer a read-only table. You can copy the address, set notes and an alias, make one primary, and open HTTP ports in the browser. The process uses the primary port after the next start.

## 0.2.62

### Activity

Each server has a timeline of who started it, edited files, restored a backup, changed a subuser, and similar actions. Filter by type, person, or search. File edits can be opened to see the lines that were added or removed. Repeated saves stack as a small pile of cards; hover for half a second to pick one, with edits at the top. File rows use icons for the file type and whether it was edited, created, or deleted.

### API

Account settings can create API keys. Account keys (`flc_`) call `/api/v1/client` as you, optionally limited to certain servers. Admins can also create application keys (`fla_`) for `/api/v1/admin`, with full access or selected scopes. The secret is shown once. Send it as `Authorization: Bearer`.

## 0.2.61

### Databases

Admins can add MySQL or MariaDB hosts. Servers with a database limit can create a database and user on those hosts, copy the connection details, rotate the password, and delete the database.

## 0.2.60

### Console

While history is loading, the console shows a spinner and “Loading console history…” instead of an empty pane.

### Files

Toasts pop in and fade out when they appear and dismiss.

### Server

The server header is a compact identity bar: back to the list, name, status pill, and copyable egg / node / address. Admins can open the current server in Admin from a link above Admin in the sidebar.

### Dashboard

The shared tab is labeled Shared with Me. Server counts use a squared badge instead of a circle.

### SFTP

The daemon now serves SFTP on the node’s SFTP port. Settings shows the address and username, and Launch SFTP opens a client. The password is the panel account password.

## 0.2.59

### Files

Folder navigation no longer breaks when you click quickly or double-click a row. The list ignores repeat clicks in the same spot, drops stale folder results, and keeps the current rows on screen until the next folder loads so the table does not collapse and jump. Click a row to open it, use the up arrow or path crumbs or Backspace to go up, and look for folder icons in the name column.

Right-click a file or folder to archive it as a `.tar.gz` in the current directory. If several rows are selected, the menu and the selection bar archive them together.

Checkboxes use a larger box and the whole cell as the click target.

Each file uses an outline icon for its extension, such as TS for `.ts` and JS for `.js`.

Upload and other progress use a thin bar at the very top of the page. Scrollbars use the same border color as the rest of the panel.

Errors such as binary files that cannot be edited appear as toasts. When files are selected, Move, Archive, and Delete replace Upload in the toolbar instead of covering the list.

## 0.2.58

### Files

Creating and renaming files or folders uses a modal instead of the browser prompt. You can also move files and folders between directories from the row menu or the selection bar.

## 0.2.57

### Console

Unlimited CPU, memory, and disk now show current usage next to an infinity icon, instead of a lone infinity character. This applies to the side cards and the CPU / memory graphs.

### Creating a server

The new-server page is laid out as Server and Network side by side, with Limits in a single row underneath.

After you pick an egg, an Advanced setup section appears. You can change that egg’s Docker image, startup command, stop command, and variables before the server is created. Those values are stored on the server and used when it installs and starts.

Extra ports starts as a dashed “Add another” control. Description is the same height as Egg and can be dragged taller. The save bar is smaller so it covers less of the form.

### Admin lists

Unlimited memory, disk, and CPU on the servers list and on a node’s server list use the same infinity icon.
