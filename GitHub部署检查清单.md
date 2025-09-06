# GitHub Pages 部署检查清单

## ✅ 已修复的问题

### 1. 路径问题
- [x] 修复了 `partials/header.html` 中的绝对路径
  - 从 `/assets/img/avatar.jpg` 改为 `assets/img/avatar.jpg`
  - 从 `/index.html` 改为 `index.html`
  - 从 `/pages/xxx.html` 改为 `pages/xxx.html`

- [x] 修复了 `assets/js/main.js` 中的路径引用
  - 从 `/index.html` 改为 `index.html`
  - 修复了路径匹配逻辑

### 2. 文件结构
- [x] 清理了不需要的文件
  - 删除了空的 `后端/` 文件夹
  - 删除了 `test-backend.html`
  - 删除了 `安装指南.md`

### 3. 轮播图
- [x] 确认 `index.html` 中的轮播图路径正确
  - 使用相对路径 `assets/img/1.png` 等
  - CSS 和 JavaScript 支持已存在

## 🔍 需要检查的项目

### 1. GitHub Pages 设置
- 确保 GitHub Pages 设置为从 `main` 分支的根目录部署
- 确保没有 `.nojekyll` 文件阻止静态文件服务

### 2. 文件上传
- 确保所有文件都已正确提交到 GitHub
- 检查是否有文件被 `.gitignore` 忽略

### 3. 浏览器缓存
- 清除浏览器缓存后重新访问
- 使用无痕模式测试

## 🚀 部署步骤

1. 提交所有更改到 GitHub
2. 等待 GitHub Pages 自动部署（通常需要几分钟）
3. 访问你的 GitHub Pages URL
4. 如果还有问题，检查浏览器开发者工具的控制台错误

## 📝 常见问题

### 问题：图片不显示
- 检查图片路径是否正确
- 确保图片文件已上传到 GitHub

### 问题：CSS 样式不生效
- 检查 CSS 文件路径
- 确保没有语法错误

### 问题：JavaScript 功能不工作
- 检查控制台是否有错误
- 确保所有依赖文件都已上传

