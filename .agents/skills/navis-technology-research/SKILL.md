---
name: navis-technology-research
description: Use for technology research, technical due diligence, competitor or ecosystem analysis, investigating why a technology emerged, its use cases and mechanism, comparing adjacent technologies, or defining capability boundaries. Load the repository's Chinese research methods and produce a traceable Research record; do not treat vendor claims or a single case as product facts.
---

# Navis 技术研究适配器

这是 Agent 适配层，不是方法论正文。每次触发都必须从仓库根目录读取以下权威文件：

1. `openspec/project.md`
2. `README.md`、`CONTRIBUTING.md`
3. `research/README.md`、`research/methods/README.md`
4. 根据问题选择并读取 `research/methods/` 中的方法文档：
   - 出现条件、问题、机制和情境：`20260816_跨项目_情境化技术研究法.md`
   - 来源、数字、冲突和置信度：`20260816_跨项目_技术证据分级与来源核验.md`
   - 比较、替代、组合和边界：`20260816_跨项目_技术比较与边界分析.md`

## 执行约束

- 先固定研究问题、范围、版本、日期和术语，再开始搜索。
- 把主张拆开，标注 `Fact`、`Observation`、`Hypothesis`、`Proposal`、`Decision` 或 `Open Question`。
- 关键数字和定位优先追溯一手来源；厂商自报数据保留“自报、未经独立验证”的限定。
- 记录有效情境、边界情境、失败或未知情境，以及与相邻技术的关系。
- 具体研究结果写入 `research/` 的正式 Research 文档，不复制到 `openspec/` 或本 Skill。
- 如果要改变方法、目录边界、Agent 自动加载规则或治理 Spec，先创建 OpenSpec 变更。
- 先声明 `target_scope` 或等价的目标项目、生态范围；如果目标是 Navis，再映射到 Navis 的 `concepts/`、`product/`、`architecture/`、`design/` 或 `decisions/`，其他目标按其对应边界处理。
- 如果研究结论要改变任一目标项目的 active 文档，先通过 Proposal/Decision 评审；研究记录本身不自动升级为产品事实。

## 最小输出

研究结果至少包含：研究问题、范围与术语、目标作用域、出现条件、问题与使用者、机制、有效/边界/失败情境、比较矩阵、证据矩阵、认识状态、对目标项目与相关生态的影响、局限、待验证问题和来源。

方法细节以 `research/methods/` 为准。若本文件与方法正文冲突，以方法正文和 OpenSpec 治理规则为准，并在研究记录中报告冲突。
