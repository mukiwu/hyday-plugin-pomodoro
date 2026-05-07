# Pomodoro

番茄工作法計時器。25 分鐘專心一件事，5 分鐘休息。

## 用法

- **Sidebar**：點「Pomodoro」進入計時器頁面
- 按「開始」進入專心時段
- 完成自動切到休息，休息完再切回專心，直到你按「重置」

## 資料

每天的完成顆數會自動每日歸零，存在 plugin 資料夾的 `data.json` 內：

```json
{ "workMinutes": 25, "breakMinutes": 5, "completedToday": 4, "lastDate": "2026-05-08" }
```
