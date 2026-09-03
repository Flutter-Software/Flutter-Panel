# Changelog

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
