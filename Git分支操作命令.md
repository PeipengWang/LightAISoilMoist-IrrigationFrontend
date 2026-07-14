# Git 分支操作命令

## 创建新分支并切换
```bash
git checkout -b <分支名称>
```

## 查看当前分支
```bash
git branch
```

## 查看当前状态
```bash
git status
```

## 查看变更差异
```bash
git diff --stat
```

## 添加文件到暂存区
```bash
git add <文件路径1> <文件路径2> ...
```

## 提交更改
```bash
git commit -m "提交信息"
```

## 切换到主分支
```bash
git checkout main
```

## 合并分支到主分支
```bash
git merge <分支名称>
```

## 删除已合并的本地分支
```bash
git branch -d <分支名称>
```

## 暂存当前未提交的更改（切换分支冲突时使用）
```bash
git stash push -- <文件路径>
```

## 恢复暂存的更改
```bash
git stash pop
```

---

## 本次操作完整流程示例

```bash
# 1. 创建并切换到新分支
git checkout -b feature/optimize-realtime-view

# 2. 确认分支
git branch

# 3. 修改代码后，添加文件到暂存区
git add src/stores/devices.ts src/views/RealTimeView.vue src/views/DecisionView.vue

# 4. 提交更改
git commit -m "优化实时显示页面：数值格式化、统一卡片模板、增强SSE状态栏、看板配置"

# 5. 如果有冲突文件，先暂存
git stash push -- "冲突文件路径"

# 6. 切换到主分支
git checkout main

# 7. 合并功能分支
git merge feature/optimize-realtime-view

# 8. 恢复暂存的文件
git stash pop

# 9. 删除已合并的本地分支
git branch -d feature/optimize-realtime-view
```
