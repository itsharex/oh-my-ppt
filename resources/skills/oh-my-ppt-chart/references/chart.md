# Chart Reference

Deep-dive examples, layout integration patterns, and Chart.js options that work reliably in Oh My PPT.

## Complete working example

Copy this pattern for every chart. Adapt the type, data, and options.

```html
<div class="ppt-chart-frame relative h-[320px] w-full overflow-hidden">
  <canvas id="chart-sales" class="h-full w-full"></canvas>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('chart-sales'), {
    type: 'bar',
    data: {
      labels: ['Q1', 'Q2', 'Q3'],
      datasets: [{
        label: 'Revenue',
        data: [12, 18, 26]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
});
</script>
```

## How PPT.createChart works

`PPT.createChart` wraps `new Chart()` and adds several layers of safety:

1. **Readiness guard**: waits for Chart.js v4 to be loaded before creating the instance.
2. **Auto-cleanup**: if a chart already exists on the same canvas, it calls `.destroy()` first — safe to re-render on the same element.
3. **Number formatting**: injects tick callbacks for value axes (trims floating-point noise) and tooltip callbacks that prefix the dataset label.
4. **Category label fix**: on category axes, injects `this.getLabelForValue(value)` so labels always render as strings.
5. **Post-creation resize**: waits 2 animation frames, then calls `chart.resize()` and `chart.update("none")` to ensure correct rendering after layout settles.
6. **Instance registry**: tracks the chart in a global registry for `PPT.updateChart`, `PPT.destroyChart`, and `PPT.resizeCharts`.

Use `PPT.createChart` — never `new Chart(...)`.

## Chart frame height guide

The `.ppt-chart-frame` parent must have an explicit `h-[Npx]` height. Chart.js requires a concrete pixel height to render — relative values (`flex-1`, `h-full`, `min-h-*`) are unreliable.

### Mandatory: calculate then write — numbers must match

Before writing the chart frame, calculate the remaining height. Write the calculation as a comment, then **use the result directly in h-[Npx]**. The number in h-[Npx] MUST equal the result of your calculation.

```html
<!-- height calc: 884 - 64(p-8) - 60(title) - 20(gap-5) - 100(metrics) - 40(h3) - 16(p-4) = 584 -->
<div class="ppt-chart-frame relative h-[584px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The comment and h-[Npx] MUST show the same number. If your comment says "= 584" then the div MUST say h-[584px]. Do NOT write a different number in h-[Npx].

Calculation steps:
1. Start from **884px** (usable height after runtime p-2 padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title/heading
6. The final result goes directly into h-[Npx] — use at least 85% of remaining space
7. Minimum 100px. If budget < 100px, the slide has too many modules — cut content.

### What not to use for height

Use only `h-[Npx]` for the chart frame. These do not work reliably:

- `h-full` — depends on parent having a fixed height, which may not exist
- `flex-1` — the chart frame is not inside a flex column with bounded height
- `min-h-*` — sets a minimum but Chart.js needs an exact height to render
- `h-64` or other Tailwind scale shortcuts — they use rem units which may not match the layout budget

## Chart type selection guide

### bar — comparisons across categories

Best for: revenue by quarter, survey results, regional comparisons.

```js
{
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
}
```

Horizontal bar: set `options.indexAxis: 'y'`. Good for ranking lists or long category labels.

### line — trends over time

Best for: monthly trends, growth trajectories, multi-series comparison over time.

```js
{
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    datasets: [
      {
        label: '2025',
        data: [30, 45, 42, 60, 55],
        borderColor: '#3B82F6',
        tension: 0.3,
        fill: false
      },
      {
        label: '2024',
        data: [20, 35, 38, 45, 40],
        borderColor: '#94A3B8',
        tension: 0.3,
        fill: false
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } }
  }
}
```

Use `tension: 0.3` for smooth curves. Use `fill: true` with `backgroundColor` at low opacity for area charts.

### pie / doughnut — parts of a whole

Best for: market share, budget allocation, category breakdown. Limit to 4–6 slices for readability.

```js
{
  type: 'doughnut',
  data: {
    labels: ['Product A', 'Product B', 'Product C', 'Other'],
    datasets: [{
      data: [40, 25, 20, 15],
      backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#94A3B8']
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' }
    }
  }
}
```

Doughnut is usually better than pie — the center can hold a total or label.

### radar — multi-axis profiles

Best for: skill comparisons, product feature matrices, performance across dimensions. Use 4–8 axes.

```js
{
  type: 'radar',
  data: {
    labels: ['Speed', 'Reliability', 'Cost', 'Support', 'Features'],
    datasets: [
      {
        label: 'Product A',
        data: [85, 70, 60, 90, 75],
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.15)'
      },
      {
        label: 'Product B',
        data: [65, 85, 80, 60, 90],
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)'
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: { beginAtZero: true, max: 100 }
    }
  }
}
```

### scatter / bubble — correlations

Best for: showing correlations, distributions, or data points with 2–3 dimensions.

```js
// Scatter: two variables
{
  type: 'scatter',
  data: {
    datasets: [{
      label: 'Team A',
      data: [{ x: 10, y: 20 }, { x: 15, y: 35 }, { x: 25, y: 30 }],
      backgroundColor: '#3B82F6'
    }]
  }
}

// Bubble: three variables (x, y, r=size)
{
  type: 'bubble',
  data: {
    datasets: [{
      label: 'Markets',
      data: [
        { x: 20, y: 30, r: 15 },
        { x: 40, y: 10, r: 8 },
        { x: 30, y: 22, r: 20 }
      ]
    }]
  }
}
```

## Updating an existing chart

Use `PPT.updateChart` to modify data or options without recreating the chart:

```js
// Patch data and options
PPT.updateChart('#my-chart', {
  data: { labels: ['New A', 'New B'], datasets: [{ data: [50, 60] }] },
  mode: 'active'
});

// Or use a callback for complex updates
PPT.updateChart('#my-chart', function(chart) {
  chart.data.datasets[0].data.push(42);
  chart.update();
});
```

`PPT.updateChart` accepts a canvas element, a CSS selector string, or an existing Chart instance.

## Category axis labels

Put category labels in `data.labels`:

```js
data: {
  labels: ['Q1', 'Q2', 'Q3'],
  datasets: [{ data: [12, 18, 26] }]
}
```

The runtime auto-injects `ticks.callback` for category axes. If you need a custom callback:

```js
ticks: {
  callback: function(value) {
    return this.getLabelForValue(value);
  }
}
```

## Layout integration tips

- Reserve space for legends, long labels, and axis ticks when budgeting chart height.
- Prefer fewer categories over tiny unreadable labels. If labels are long, use horizontal bar (`indexAxis: 'y'`).
- Place charts as dedicated visual modules in the grid, not nested inside cards with other content.
- Always set `responsive: true` and `maintainAspectRatio: false` — they work with the explicit-height frame.
- For a chart + metric cards layout, use `grid grid-cols-[1fr_1fr]` or `grid grid-cols-3` with the chart spanning 2 columns.

## Common patterns

- **Hero metric + chart**: `grid grid-cols-[1fr_2fr]` — metric card on the left with `text-5xl` number, chart on the right. Chart height ~300px.
- **Two charts side by side**: `grid grid-cols-2` — each chart in its own column with a small heading above. Chart height ~260px.
- **Metrics row + chart below**: compact `grid-cols-4` metric cards (p-3) on top, single chart spanning full width below.
