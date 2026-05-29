---
name: oh-my-ppt-chart
description: Must be read before adding or modifying Oh My PPT slide charts. Defines product-safe Chart.js usage, canvas layout constraints, axis label rules, and retry fixes.
---

# Oh My PPT Chart

For deeper examples (chart frame height guide, category axis patterns, layout integration tips), read `references/chart.md`.

## When to use

- Adding a chart to a new or existing slide
- Modifying chart type, data, or options
- Repairing a blank or broken chart canvas

## When not to use

- Pure visual micro-edits that don't change chart structure (e.g. adjusting a single color value). These still follow chart skill hard rules, but don't require reading the full reference.

## 30-second decision checklist

Before writing chart HTML, answer these in order:

1. **Chart type**: bar, line, pie, doughnut, radar, polarArea, scatter, bubble?
2. **Height budget**: how much vertical space remains after title, modules, gaps? Chart frame must fit within the slide's 884px budget.
3. **Data shape**: labels + datasets. Are there enough data points for the chosen type?
4. **Script event**: DOMContentLoaded only — the runtime loads Chart.js before this event fires.

## How to create a chart

Every chart needs exactly two parts: an HTML frame with explicit height, and a script block using DOMContentLoaded + PPT.createChart.

### 1. HTML — chart frame with explicit height

Before writing the chart frame, you MUST calculate the height. Write the calculation as a comment, then **use the result directly in h-[Npx]**. The number in h-[Npx] MUST equal the result of your calculation. Do NOT write a different number.

```html
<!-- height calc: 884 - 48(p-6) - 68(title) - 24(gap-6) - 28(h3) - 8(gap-2) = 708 -->
<div class="ppt-chart-frame relative h-[708px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The comment and h-[Npx] MUST show the same number. If your comment says "= 708" then the div MUST say h-[708px].

Calculation steps:
1. Start from 884px (usable height after runtime p-2 padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title
6. The final result goes directly into h-[Npx] — use at least 85% of remaining space
7. Minimum 100px. If budget < 100px, the slide has too many modules — cut content.

### 2. JavaScript — always use DOMContentLoaded + PPT.createChart

```html
<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('my-chart'), {
    type: 'bar',
    data: {
      labels: ['A', 'B', 'C'],
      datasets: [{
        label: 'Revenue',
        data: [10, 20, 30],
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
});
</script>
```

This is the only correct event and the only correct API. The runtime loads Chart.js before `DOMContentLoaded` fires, so the helper is always available inside this callback.

### Complete working example

```html
<div class="grid grid-cols-2 gap-4">
  <div class="flex flex-col gap-2">
    <h3 class="text-2xl font-bold">Quarterly Revenue</h3>
    <p class="text-base text-gray-500">Growth trend across regions</p>
  </div>
  <div class="ppt-chart-frame relative h-[280px] w-full overflow-hidden">
    <canvas id="revenue-chart" class="h-full w-full"></canvas>
  </div>
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('revenue-chart'), {
    type: 'bar',
    data: {
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [{
        label: 'Revenue (M)',
        data: [12, 19, 15, 22],
        backgroundColor: '#3B82F6'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
});
</script>
```

## Hard rules

- Use `PPT.createChart(canvasElement, config)` — pass the canvas DOM element, not a 2D context.
- Wrap every `PPT.createChart` call inside `document.addEventListener('DOMContentLoaded', function() { ... })`.
- Put category labels in `data.labels`. If a category-axis `ticks.callback` is needed, return `this.getLabelForValue(value)`.
- Derive chart frame height from the layout budget (884px minus all other modules). Minimum 240px. Do not pick from preset ranges.
- Do not add padding to the `.ppt-chart-frame` div — it wastes height budget without visual benefit. Padding belongs on the parent card/container, not on the chart frame itself.
- Keep chart code local and deterministic.

## Failure repair strategy

When a chart is blank or broken:

1. **Check the event**: the script must use `DOMContentLoaded`. Any other event name (ppt-ready, ppt-rendered, ppt-page-ready, load, etc.) will not fire or fire too early.
2. **Check the canvas id**: the `getElementById` string must match the canvas `id` attribute exactly.
3. **Check the height**: the chart frame `h-[Npx]` must be a positive number. A missing or zero height produces an invisible canvas.
4. **Check the data format**: labels must be an array of strings, datasets an array of objects with a `data` array of numbers.
5. **Remove duplicate scripts**: if editing a page that already has a chart, merge scripts rather than adding a second `DOMContentLoaded` listener for the same canvas.

## Chart animation boundary

Two levels of chart animation, each handled by a different system:

- **Chart container entrance** (the whole chart block fading/sliding in): add `data-anim` on the `.ppt-chart-frame` div. This is a standard layout animation — see animation skill.
- **Chart internal drawing** (bars growing, lines drawing, pie slices rotating): controlled by Chart.js `options.animation`. The runtime defaults handle this; you rarely need to customize it.
- **Do not** write custom JS timelines that animate individual chart elements. Use `data-anim` for the container, and Chart.js options for the internals.

## Cross-skill references

- Budget chart height from the slide's 884px total (see layout skill). Title + modules + gaps + chart frame ≤ 884px.
- Chart container entrance animation uses `data-anim` on the chart frame div (see animation skill).
