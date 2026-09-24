# TC Papers

[English](README.md) | [日本語](README.ja.md) | 中文

借助 AI 阅读论文的 Web 应用。拖入 PDF，即可获得审稿人视角的评分，或将论文的叙事脉络绘制成图，通过提问逐步加深理解。

在线版：https://tik-choco.github.io/tc-papers/

## 功能

- **评审**：AI 从六个维度（技术合理性、实证强度、新颖性、重要性、清晰度、可复现性）评分，并附上论文原文引用。最终分数（0–100）在本地计算，引用在正文中找不到的评分会被拉回中性。
- **理解模式**：把论文整理成叙事图（问题 → 方法 → 结果 → …）。每次提问，答案都会添加到理解树中，并可与 PDF 并排阅读。理解树变乱时，可用“整理”合并重复内容并调整位置和顺序（可撤销）。
- **OCR**：只有图像的页面由支持图像输入的模型识别。
- **tc-pdf-viewer 联动**：可导入 tc-pdf-viewer 中已有的 PDF。
- **本地优先**：PDF 和结果保存在浏览器中，并自动备份到 tc-storage。

## AI

使用 tc 系列应用共享的 mistai 设置（任意 OpenAI 兼容 API，或 AI Network（P2P））。首次启动时会打开设置向导。PDF 正文和页面图像会发送给你所选的 AI。

## 开发

```sh
npm install
npm run dev
npm test
npm run test:e2e
npm run build   # 部署到子路径时使用 VITE_BASE_PATH=/tc-papers/
```

## 许可证

[MIT](LICENSE)
