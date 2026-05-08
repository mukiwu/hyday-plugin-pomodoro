# Pomodoro

番茄工作法計時器，常駐 Hyday 右上角 nav bar。點 icon 展開計時面板。

## 用法

- **開始**：點右上角 ⏱ icon → 展開面板 → 按「開始」
- **計時面板**內可調工作/休息時長，立即生效
- 完成自動切到休息，休息完再切回工作；按「重置」可隨時歸位
- 面板關閉**不會中斷計時**，狀態保留在背景；下次點開會看到當下的剩餘時間

## 資料

每日完成顆數會自動歸零，存在 plugin 資料夾的 `data.json`：

```json
{ "workMinutes": 25, "breakMinutes": 5, "completedToday": 4, "lastDate": "2026-05-08" }
```

## 變更紀錄

**v2.1.0**
- 階段結束三層通知：sticky toast + 系統 native notification + 雙音 beep
- 第一次按「開始」會跳系統通知授權（可拒絕，仍會有 toast + beep）
- toast 改為持久顯示（要點才關），離開電腦回來仍看得到

**v2.0.0**
- 從 sidebar 全螢幕 view 改成 nav bar status item + popover panel
- 計時器在背景運作，popover 關閉不影響進度

## 權限

- `ui:statusBar` — 在 nav bar 顯示 icon
- `storage` — 記每日完成數與設定
