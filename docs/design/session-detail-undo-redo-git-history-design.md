# session-detail 撤销/重做与 Git 版本历史设计

## 背景

`session-detail` 现在有两套“历史”概念：

- 前端临时编辑历史：`useEditHistoryStore` 维护当前未保存的页面编辑，包括 `dragEdits`、`textEdits`、`propertyEdits`、`deletes`、`addElements`，并用 `undoStack` / `redoStack` 存这些数组的快照。
- 真实版本历史：主进程 `GitHistoryService` 用项目目录里的 `.git` 记录受控文件变更，并在数据库里保存 operation/page snapshot。用户点“版本历史”时看到的是这套历史。

这两套历史不应该硬合成一套。更合理的产品模型是“双层历史”：

- 当前页撤销/重做：只管理当前页面里的短期、细粒度操作。
- 当前页保存：把当前页面状态写入文件，并生成一个 Git 版本点。
- 全局 Git 版本历史：管理整套 deck/session 的长期版本，包括保存、生成、导入、增删页、重排、回退等已落盘操作。

## 当前代码事实

### 前端编辑历史

文件：`src/renderer/src/store/editHistoryStore.ts`

当前 store 存的是“待保存编辑快照”，不是严格意义上的“操作命令栈”。

状态结构：

- `dragEdits`
- `textEdits`
- `propertyEdits`
- `deletes`
- `addElements`
- `undoStack`
- `redoStack`

每次调用：

- `upsertDragEdit`
- `upsertTextEdit`
- `upsertPropertyEdit`
- `addDelete`
- `addElement`

都会先 `takeSnapshot(...)`，再修改当前五类编辑数组。`undo()` / `redo()` 只是恢复上一份五类数组快照。

这个模型的优点是实现简单，能直接给 `saveEditBatch` 使用。缺点是它不是语义操作栈：

- 一次“设置背景”可能拆成删除旧背景 + 添加新背景，当前会产生多个快照。
- 多次调整同一个属性会 merge 到同一个 `propertyEdits`，但 undo 栈里可能已经有多个中间快照。
- 当前撤销后通过刷新 iframe 再 `replayPendingEdits()` 恢复状态，粒度偏粗。

### 保存链路

文件：`src/renderer/src/pages/session-detail.tsx`

`handleSaveAllEdits()` 会：

1. `commitCurrentElementEdit()`
2. `editHistory.getSnapshotForPage(pageId)`
3. 过滤已删除元素对应的 drag/text/property edits
4. 调用 `ipc.saveEditBatch(...)`
5. 成功后 `editHistory.clearPage(pageId)`

这说明当前实现里的前端 undo/redo 只对“未保存编辑”有效。一旦保存成功，真实历史进入 `.git`，前端临时栈被清空。

这不完全符合 WPS/Office 的长期目标。理想语义里，保存不应该等于清空撤销栈，保存只是建立当前页状态的 Git 版本点；保存后用户仍然可以撤销当前页最近操作，撤销后当前页重新变成 dirty。

但现有前端 store 只保存“相对当前页面文件的待保存 patch”，没有保存反向操作或完整 DOM 状态。页面一旦保存，HTML 文件基线已经改变，旧的空 snapshot 不再代表保存前页面。因此第一阶段先保证“保存前当前页操作可完整撤销/重做”；保存后继续撤销保存前操作，需要第二阶段新增反向 command 或当前页 Git restore 能力。

### Git 版本历史

文件：`src/main/history/git-history-service.ts`

`GitHistoryService.recordOperation()` 会：

1. 确保项目目录是 git repo
2. stage 受控文件变更
3. 创建 session operation
4. commit 到项目目录 `.git`
5. 捕获 page snapshot
6. 更新 session 当前 history pointer

受控文件包括：

- `index.html`
- 页面 HTML
- `assets/`
- `.gitignore`

`history:listVersions` 和 `history:rollbackToVersion` 走的都是这套 Git history。

### 绕过前端 editHistory 的入口

当前 AI 生图添加到画布 / 设置背景走了 `persistImmediately: true`：

- `handleAddGeneratedImageToCanvas`
- `handleSetGeneratedImageAsBackground`

它们会在 `handleAddElement()` 内直接 `ipc.saveEditBatch(...)`，因此会直接进入 Git 版本历史，不进入前端 `editHistory`。

这会造成产品上的割裂：

- 从素材库/本地上传添加元素：先进入未保存编辑，可撤销。
- 从 AI 生图添加元素：直接保存成 Git 历史，不能用同一个撤销按钮撤销。

## 目标产品语义

用户应该理解为：

- `撤销/重做`：只撤销当前页最近一次操作，来源不限于编辑面板、插入、AI、快捷键、画布拖拽。
- `保存`：把当前页当前状态写入文件，并生成一个 Git operation。
- `版本历史`：查看和回退已经保存/生成/导入/页面管理产生的全局长期版本。

关键点：

- 撤销/重做不应该直接操作 `.git`。
- 第一阶段：保存当前页后清空当前页临时 patch 栈，真实回退交给 Git 版本历史。
- 第二阶段：引入 `savedCheckpoint` / 反向 command / 当前页 Git restore 后，再支持保存后继续撤销保存前操作。
- 跨页和全局操作不进入当前页撤销/重做，统一交给 Git 版本历史。

## 建议分层

### 1. Operation Layer：前端操作栈

新增语义化 operation，而不是直接把五类 patch 数组当操作。

建议类型：

```ts
type EditOperation =
  | { type: 'moveElement'; pageId: string; selector: string; patch: DragEditItem }
  | { type: 'resizeElement'; pageId: string; selector: string; patch: DragEditItem }
  | { type: 'updateElementProperties'; pageId: string; selector: string; patch: PropertyEditItem }
  | { type: 'addElement'; pageId: string; item: AddElementItem }
  | { type: 'deleteElement'; pageId: string; item: DeleteItem }
  | { type: 'replaceBackground'; pageId: string; deletes: DeleteItem[]; add: AddElementItem }
  | { type: 'compound'; pageId: string; label: string; operations: EditOperation[] }
```

`compound` 很重要，用来把多个底层 patch 合并成一次用户操作。例如：

- 设置背景 = 删除旧背景样式 + 删除旧背景图 + 添加新背景图
- 复制元素 = 添加元素 + 选中新元素
- AI 添加到画布 = 添加元素

### 2. Patch Aggregate Layer：待保存 patch 聚合

保留当前五类数组作为“保存用聚合结果”：

- `dragEdits`
- `textEdits`
- `propertyEdits`
- `deletes`
- `addElements`

但它们不再直接作为 undo/redo 的核心语义，而是由 operation stack 派生/维护。

有两种实现方式：

方案 A：每次 operation 入栈时，同时更新五类数组。

- 改动较小。
- 适合第一阶段。
- undo/redo 仍可以恢复 aggregate snapshot。

方案 B：只存 operation stack，每次需要保存或 replay 时 reduce 出五类数组。

- 模型更干净。
- 改动更大。
- 更适合后续彻底重构。

第一阶段建议用方案 A：保留当前 store 的 aggregate，给每次操作加 `transaction` 包装，避免一次用户动作产生多个 undo 点。

### 3. Commit Layer：Git 版本历史

保存时仍调用 `saveEditBatch`。一次保存对应一个 Git operation。

不要把每次 undo/redo 都写 Git。否则用户拖一下、撤一下就会污染版本历史。

长期目标里，保存是 checkpoint，不是清空操作：

```ts
type PageEditHistory = {
  aggregate: EditSnapshot
  undoStack: EditSnapshot[]
  redoStack: EditSnapshot[]
  savedCheckpoint: EditSnapshot
}
```

当前页是否 dirty，不再简单等于“aggregate 是否为空”，而是：

```text
dirty = currentAggregate !== savedCheckpoint
```

第二阶段实现后，保存成功应当：

- 更新 `savedCheckpoint = currentAggregate`。
- 清空 `redoStack` 可以接受，因为保存后继续 redo 语义通常不稳定。
- 不清空 `undoStack`，用户保存后仍可撤销最近操作。
- 如果用户保存后撤销，`currentAggregate` 会回到旧状态，此时 `dirty = true`。

第一阶段先不启用这个语义。原因是当前 aggregate 不是完整页面状态，保存后继续 replay 旧 aggregate 会导致元素重复注入或 patch 基线错误。

保存时的 prompt 可以根据 operation labels 生成，例如：

- `编辑：移动 2 个元素、修改 1 个属性`
- `插入：添加 1 张图片`
- `AI：添加生成图片到画布`
- `AI：设置页面背景`

## 合并处理规则

### 同一元素拖拽

用户拖拽一次只产生一个 operation。

当前 iframe 在 pointerup 后才发送 `moved` 消息，所以天然接近一个事务。保留这个边界即可。

合并规则：

- 同一 selector 多次拖拽，可以在 aggregate 中只保留最终 `DragEditItem`。
- undo 栈中每次拖拽仍是一次用户操作。

### 属性面板输入

当前很多字段是 live preview，blur 或按钮点击时才 commit。

规则：

- `onChange` 只做 live preview，不入 undo stack。
- `onBlur` / `onCommit` 入一次 operation。
- 输入值未变化不入栈。

### 添加元素

规则：

- 插入文本、素材库图片、本地上传图片/视频、AI 添加图片都走同一个 `addElement` operation。
- 不要因为来源不同决定是否立刻 Git commit。
- 由用户统一点保存，或者在特殊场景提示“已加入未保存编辑”。

### 设置背景

设置背景是复合操作。

规则：

- 删除旧 `[data-ppt-generated-background="1"]`
- 删除旧 `[data-ppt-generated-background-style="1"]`
- 添加新背景元素

合并为一个 `replaceBackground` 或 `compound` operation。

undo 一次应该完整恢复到设置背景前，而不是先撤销添加、再撤销删除。

### 删除元素

规则：

- 删除前先 commit 当前选中元素草稿。
- 删除本身作为一次 operation。
- aggregate 保存时继续执行“删除优先”，并过滤被删除元素的其它 edits。

### 保存

规则：

- 第一阶段：保存成功后写入 Git 版本点，并清空当前页临时 patch / undo / redo。
- 第二阶段：保存成功后改为更新当前页 `savedCheckpoint`，不要清空当前页 `undoStack`。
- 保存成功后当前页应标记为 clean。
- 第一阶段保存后如果要回到保存前状态，通过版本历史回退。
- 第二阶段保存后如果用户继续撤销/编辑，当前页重新标记为 dirty。
- 保存失败不清空。
- 保存前要填充复制元素的 `htmlFragment`，这条现有逻辑继续保留。

### 切页

第一阶段明确：undo/redo 只作用于当前页面，不做全局撤销栈。

原因：

- 当前 `getSnapshotForPage(pageId)` 已按页面过滤。
- 保存也是按当前 page 的 `htmlPath/pageId` 调 `saveEditBatch`。
- 跨页 undo 会牵涉选中页跳转、iframe reload、多个页面 dirty 状态，成本明显上升。

产品上可以表达为：

- 选中某页时，撤销该页操作。
- 切页保留每页未保存操作，但按钮状态按当前页显示。
- 当前页保存只保存当前页，并生成一个 Git 版本点。
- 全局/跨页的历史回退走“版本历史”，不走当前页撤销/重做。

当前 store 的 `undoStack` 是全局的，里面存的是全局 aggregate 快照。要支持“每页独立撤销”，需要把栈改成 per-page：

```ts
type PageEditHistory = {
  aggregate: EditSnapshot
  undoStack: EditSnapshot[]
  redoStack: EditSnapshot[]
  savedCheckpoint: EditSnapshot
}

type EditHistoryState = {
  pages: Record<string, PageEditHistory>
}
```

### AI 入口

第一阶段建议去掉 AI 添加到画布的 `persistImmediately: true`。

改为：

- 切到编辑模式。
- 把 AI 结果作为 `addElement` 或 `replaceBackground` operation 入栈。
- toast 文案改成“已添加到画布，记得保存”。
- 保存时 prompt 带 AI 来源。

如果确实需要“AI 结果立即保存”，那它应该走 Git history，不归当前撤销/重做按钮管。这个产品语义要明确，否则用户会觉得撤销按钮不可信。

## 页面管理是否纳入撤销

不纳入当前页撤销/重做。

页面新增、空白页、删页、重排、标题、大纲更新目前都直接调用 IPC 修改 session pages，并刷新 generate/session store。它们属于 deck/page 级操作，已经适合进入 Git 版本历史。

如果要支持页面管理撤销，建议走另一个能力：

- 对已保存页面操作，提供“版本历史回退”。
- 或新增“最近一次页面操作撤销”，本质上调用 Git rollback 到 before operation。

但这不应该和当前页元素编辑的 Ctrl+Z 混在一起做。

最终边界：

```text
当前页内元素/动画/背景操作 -> 当前页撤销/重做
跨页、页面管理、生成、导入、历史回退 -> Git 版本历史
```

## 推荐落地阶段

### 第一阶段：统一当前页操作

范围：

- 画布拖拽/缩放
- 属性面板
- 删除元素
- 复制元素
- 添加文本
- 插入图片/视频
- AI 添加图片
- AI 设置背景
- 当前页元素动画配置

不包含：

- 新增页面
- 删除页面
- 重排页面
- 改标题/大纲
- 版本历史回退
- 导出/演示/查看文件

实现：

1. 重构 `editHistoryStore`，引入 per-page history。
2. 增加 `beginTransaction` / `commitTransaction` 或 `applyOperation`。
3. 把背景替换、复制、AI 添加这类复合动作合成一次 operation。
4. `canUndo/canRedo` 改为接收当前 pageId 或提供 selector。
5. `handleUndo/handleRedo` 基于当前页操作，并刷新/replay 当前页。
6. 去掉 AI 添加入口的 `persistImmediately: true`，统一进当前页操作栈。
7. 保存成功后清空当前页临时 patch / undo / redo，并写入 Git 版本点。

### 第二阶段：Git history 与页面操作协同

范围：

- 保存后在 Git history 中生成更好的 operation prompt。
- 页面管理操作的版本历史记录更清晰。
- 提供当前页级的“撤销已保存操作”：底层可以走当前页文件 Git restore，或改造前端 command 保存反向操作。
- 支持保存后继续撤销保存前操作，更新 dirty 状态并允许再次保存生成新的 Git 版本点。

这阶段要非常谨慎，因为 rollback 会恢复文件和 DB page snapshot，和当前未保存编辑不能同时存在。

## UI 建议

撤销/重做不应该只藏在“编辑”tab 内。

建议：

- 放在左侧固定工具区：保存 / 撤销 / 重做。
- `预览` tab 下如果当前页有可撤销操作，也可显示可用状态。
- tooltip 文案明确：`撤销当前页最近操作`。
- 保存按钮 tooltip：`保存当前页，并写入版本历史`。

### 组件分层

页面级工作区不继续堆在 `session-detail/` 根目录下。`session-detail` 页面只负责会话数据、IPC、保存和页面选择等业务编排；可复用的工作区 UI 放到 `src/renderer/src/components/presentation-workspace/`。

建议边界：

- `presentation-workspace/WorkspaceRibbon.tsx`：组合页面工作区 ribbon，读取全局 `useSessionDetailUiStore` 的 `workspaceTab` / `interactionMode`。
- `presentation-workspace/toolbar/PrimaryActions.tsx`：主页、保存当前页、当前页撤销、当前页重做。
- `presentation-workspace/toolbar/WorkspaceTabs.tsx`：预览、编辑、插入、动画、演讲稿、AI 模式 tab。
- `presentation-workspace/toolbar/DynamicToolRow.tsx`：第二行动动态工具区的路由层，只按当前 tab 选择对应工具组件。
- `presentation-workspace/toolbar/tool-rows/PreviewToolRow.tsx`：预览 tab 的二级工具，当前为空。
- `presentation-workspace/toolbar/tool-rows/EditToolRow.tsx`：编辑 tab 的二级工具，当前为空。
- `presentation-workspace/toolbar/tool-rows/InsertToolRow.tsx`：插入 tab 的二级工具，当前包含添加文本/图片/视频。
- `presentation-workspace/toolbar/tool-rows/AnimationToolRow.tsx`：动画 tab 的二级工具，当前为空。
- `presentation-workspace/toolbar/tool-rows/SpeechToolRow.tsx`：演讲稿 tab 的二级工具，当前为空。
- `presentation-workspace/toolbar/tool-rows/AiToolRow.tsx`：AI tab 的二级工具，当前为空。
- `presentation-workspace/workbench/`：右侧动态面板，例如插入面板、动画面板、空编辑面板。

状态仍放在全局 store：

- UI 状态：`src/renderer/src/store/sessionDetailStore.ts`
- 当前页编辑历史：`src/renderer/src/store/editHistoryStore.ts`

组件不再自己维护一套局部模式状态，只通过全局 store 派生当前 tab、交互模式和当前页撤销/重做能力。

这样和 Git 历史的关系更清楚：

- 撤销/重做：当前页操作。
- 保存：当前页 checkpoint。
- 版本历史：全局已保存版本。

## 关键风险

1. 复合操作如果不合并，会导致一次用户动作需要撤销多次。
2. AI 入口如果继续直接保存，会破坏“所有渠道都可撤销”的承诺。
3. 每页独立 history 如果不做，跨页操作后 undo 可能撤销到其它页状态。
4. 第一阶段保存后会清空当前页临时 undo 栈；这是 patch 基线限制，不是最终 WPS-like 体验。
5. 第二阶段如果不处理 checkpoint/反向操作，保存后继续撤销会导致 dirty 状态和 DOM replay 不可信。
6. Git rollback 前必须禁止或提示处理未保存编辑，否则会丢失前端临时操作。

## 结论

可以做，而且方向是对的。但不要把前端撤销/重做和 `.git` 版本历史做成同一个栈。

推荐模型是：

```text
当前页用户操作
  -> 当前页 operation stack（撤销/重做）
  -> 当前页 patch aggregate
  -> 当前页保存 saveEditBatch
  -> GitHistoryService.recordOperation（全局真实版本历史）

跨页/全局操作
  -> 直接进入 GitHistoryService.recordOperation
  -> 通过版本历史回退
```

第一阶段先保证“当前页内、所有入口一致可撤销”。第二阶段再把已保存操作和页面管理操作通过 Git history 做更强的版本回退体验。
