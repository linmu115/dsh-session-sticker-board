# 0.4.7 - Bridge queue restart recovery

- Track the Obsidian Bridge queue identity as well as its numeric cursor.
- Reset the local cursor when Obsidian reloads the Bridge, including when the new queue reuses the same cursor number.
- Report individual Bridge action failures with the action type and ID instead of silently swallowing them.
