import { getDiagnosticMeasurements } from '../api/nodel-host-client';
import type { NodelDiagnosticMeasurement } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import type { Chart as ChartInstance, ChartConfiguration } from 'chart.js';

type LineChart = ChartInstance<'line', number[], string>;
type ChartConstructor = new (item: HTMLCanvasElement, config: ChartConfiguration<'line', number[], string>) => LineChart;
type UpdatableLineChart = LineChart & { config?: ChartConfiguration<'line', number[], string>; update?: (mode?: string) => void };

interface ChartCategoryView {
  name: string;
  selected: boolean;
}

interface CategorizedMeasurement extends NodelDiagnosticMeasurement {
  category: string;
  subcategory: string;
}

interface DiagnosticChartsViewModel {
  categories: ChartCategoryView[];
  empty: boolean;
  error: string;
  hasCategories: boolean;
  loading: boolean;
  noSelection: boolean;
  visibleMeasurements: CategorizedMeasurement[];
}

const template = `
  <div class="nodel-diagnostic-charts space-y-3">
    {^{if hasCategories}}
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-sm font-medium text-nodel-fg">Categories</div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="nodel-button nodel-button-compact" data-diagnostic-chart-select="all" data-link="disabled{:loading || !!error}">All</button>
            <button type="button" class="nodel-button nodel-button-compact" data-diagnostic-chart-select="none" data-link="disabled{:loading || !!error}">None</button>
          </div>
        </div>
        <fieldset class="nodel-diagnostic-category-picker" aria-label="Categories" data-link="disabled{:loading || !!error}">
          {^{for categories}}
            <label class="nodel-diagnostic-category-option">
              <input class="nodel-choice" data-diagnostic-chart-category type="checkbox" data-link="value{:name} checked{:selected}" />
              <span class="truncate">{^{>name}}</span>
            </label>
          {{/for}}
        </fieldset>
      </div>
    {{/if}}
    {^{if error}}
      <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{>error}}</div>
    {{else loading}}
      <div class="nodel-alert nodel-alert-md">Loading diagnostic measurements...</div>
    {{else empty}}
      <div class="nodel-alert nodel-alert-md">No diagnostic measurements.</div>
    {{else noSelection}}
      <div class="nodel-alert nodel-alert-sm">Select one or more categories to show charts.</div>
    {{/if}}
    <div class="nodel-diagnostic-chart-grid">
      {^{for visibleMeasurements}}
        <article class="nodel-diagnostic-chart-card" title="">
          <h4 class="nodel-diagnostic-chart-title">{^{>subcategory}}</h4>
          <div class="nodel-diagnostic-chart-canvas-wrap">
            <canvas data-diagnostic-chart="{{:name}}" aria-label="{{:name}}" title=""></canvas>
          </div>
        </article>
      {{/for}}
    </div>
  </div>
`;

function categoryParts(measurement: NodelDiagnosticMeasurement) {
  const separator = measurement.name.indexOf('.');
  if (separator > 0 && separator < measurement.name.length - 1) {
    return {
      category: measurement.name.slice(0, separator),
      subcategory: measurement.name.slice(separator + 1)
    };
  }

  return {
    category: 'general',
    subcategory: measurement.name
  };
}

function sortedMeasurements(measurements: NodelDiagnosticMeasurement[]): CategorizedMeasurement[] {
  return [...measurements]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((measurement) => ({
      ...measurement,
      ...categoryParts(measurement)
    }));
}

function uniqueCategories(measurements: CategorizedMeasurement[]) {
  return Array.from(new Set(measurements.map((measurement) => measurement.category))).sort((a, b) => a.localeCompare(b));
}

function cssColor(name: string, alpha?: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) {
    return alpha === undefined ? 'rgb(0 0 0)' : `rgb(0 0 0 / ${alpha})`;
  }

  return alpha === undefined ? `rgb(${value})` : `rgb(${value} / ${alpha})`;
}

function toChartValues(measurement: NodelDiagnosticMeasurement) {
  const scale = measurement.isRate ? 10 : 1;
  return (measurement.values ?? []).map((value) => Number(value) / scale);
}

const chartInteraction = {
  axis: 'x' as const,
  intersect: false,
  mode: 'index' as const
};

export class NodelDiagnosticCharts extends HTMLElement {
  private charts = new Map<string, LineChart>();
  private chartConstructor: ChartConstructor | null = null;
  private categoryKey = '';
  private linked = false;
  private measurements: CategorizedMeasurement[] = [];
  private mutationObserver: MutationObserver | null = null;
  private selectedCategories = new Set<string>();
  private source: NodelSourceSubscription<NodelDiagnosticMeasurement[]> | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';
  private state: NodelSourceState<NodelDiagnosticMeasurement[]> = {
    loading: true,
    data: null,
    error: '',
    active: false,
    updatedAt: null
  };
  private view: DiagnosticChartsViewModel = {
    categories: [],
    empty: false,
    error: '',
    hasCategories: false,
    loading: true,
    noSelection: false,
    visibleMeasurements: []
  };
  private drawToken = 0;
  private lastAppliedUpdatedAt: number | null = null;
  private visibleMeasurementKey = '';

  connectedCallback() {
    if (!this.sourceKey) {
      NodelDiagnosticCharts.nextSourceId += 1;
      this.sourceKey = `nodel-diagnostic-charts-${NodelDiagnosticCharts.nextSourceId}`;
    }

    this.addEventListener('change', this.handleChange);
    this.addEventListener('click', this.handleClick);
    this.mutationObserver = new MutationObserver(() => {
      void this.drawCharts();
    });
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    void this.initialize();
  }

  disconnectedCallback() {
    this.removeEventListener('change', this.handleChange);
    this.removeEventListener('click', this.handleClick);
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.source?.dispose();
    this.source = null;
    this.destroyCharts();
    void unlinkTemplate(this);
    this.linked = false;
  }

  private async initialize() {
    if (!this.linked) {
      await linkTemplate(this, template, this.view);
      this.linked = true;
      this.updateView();
    }

    if (!this.source) {
      this.bindSource();
    }
  }

  private bindSource() {
    this.source?.dispose();
    const source = registerNodelPollSource<NodelDiagnosticMeasurement[]>({
      key: this.sourceKey,
      intervalMs: 10000,
      visibleOnly: true,
      fetcher: (signal) => getDiagnosticMeasurements({ signal })
    });

    this.source = source.subscribe(this, (state) => {
      this.state = state;
      if (state.data && state.updatedAt !== this.lastAppliedUpdatedAt) {
        this.lastAppliedUpdatedAt = state.updatedAt;
        this.measurements = sortedMeasurements(state.data);
      }
      this.updateView();
    });
  }

  private handleChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches('[data-diagnostic-chart-category]')) {
      return;
    }

    if (target.checked) {
      this.selectedCategories.add(target.value);
    } else {
      this.selectedCategories.delete(target.value);
    }
    this.updateView();
  };

  private handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('[data-diagnostic-chart-select]');
    if (!button) {
      return;
    }

    const mode = button.dataset.diagnosticChartSelect;
    const categories = uniqueCategories(this.measurements);
    this.selectedCategories = mode === 'all' ? new Set(categories) : new Set();
    this.updateView();
  };

  private async getChartConstructor() {
    if (this.chartConstructor) {
      return this.chartConstructor;
    }

    const mod = await import('chart.js/auto') as { default: ChartConstructor };
    this.chartConstructor = mod.default;
    return this.chartConstructor;
  }

  private destroyCharts() {
    for (const chart of this.charts.values()) {
      chart.destroy();
    }
    this.charts.clear();
  }

  private destroyChartsExcept(visibleNames: Set<string>) {
    for (const [name, chart] of this.charts) {
      if (!visibleNames.has(name)) {
        chart.destroy();
        this.charts.delete(name);
      }
    }
  }

  private selectedMeasurements() {
    return this.measurements.filter((measurement) => this.selectedCategories.has(measurement.category));
  }

  private updateView() {
    if (!this.linked) {
      return;
    }

    const categories = uniqueCategories(this.measurements);
    const visibleMeasurements = this.selectedMeasurements();
    const nextCategoryKey = categories.join('\n');
    const $ = getJQuery();

    this.dataset.state = this.state.error ? 'error' : this.state.loading ? 'loading' : categories.length > 0 ? 'ready' : 'empty';
    $.observable(this.view).setProperty({
      empty: !this.state.loading && !this.state.error && categories.length === 0,
      error: this.state.error,
      hasCategories: categories.length > 0,
      loading: this.state.loading,
      noSelection: !this.state.loading && !this.state.error && categories.length > 0 && visibleMeasurements.length === 0
    });

    if (nextCategoryKey !== this.categoryKey) {
      this.categoryKey = nextCategoryKey;
      $.observable(this.view.categories).refresh(categories.map((category) => ({
        name: category,
        selected: this.selectedCategories.has(category)
      })));
    } else {
      for (const category of this.view.categories) {
        $.observable(category).setProperty('selected', this.selectedCategories.has(category.name));
      }
    }

    const nextVisibleMeasurementKey = visibleMeasurements.map((measurement) => measurement.name).join('\n');
    if (nextVisibleMeasurementKey !== this.visibleMeasurementKey) {
      this.visibleMeasurementKey = nextVisibleMeasurementKey;
      $.observable(this.view.visibleMeasurements).refresh(visibleMeasurements);
    }
    void this.drawCharts();
  }

  private async drawCharts() {
    const token = ++this.drawToken;
    const visibleMeasurements = this.selectedMeasurements();
    const visibleNames = new Set(visibleMeasurements.map((measurement) => measurement.name));
    this.destroyChartsExcept(visibleNames);

    if (visibleMeasurements.length === 0) {
      return;
    }

    const Chart = await this.getChartConstructor();
    if (token !== this.drawToken || !this.isConnected) {
      return;
    }

    const fg = cssColor('--nodel-fg');
    const muted = cssColor('--nodel-muted');
    const border = cssColor('--nodel-border');
    const accent = cssColor('--nodel-accent');
    const accentFill = cssColor('--nodel-accent', 0.14);

    const canvases = new Map(
      Array.from(this.querySelectorAll<HTMLCanvasElement>('canvas[data-diagnostic-chart]'))
        .map((canvas) => [canvas.dataset.diagnosticChart ?? '', canvas] as const)
        .filter(([name]) => name)
    );

    for (const measurement of visibleMeasurements) {
      const canvas = canvases.get(measurement.name);
      if (!canvas) {
        continue;
      }

      const values = toChartValues(measurement);
      const labels = values.map((_, index) => String(index + 1));
      const existing = this.charts.get(measurement.name) as UpdatableLineChart | undefined;
      if (existing) {
        if (existing.canvas && existing.canvas !== canvas) {
          existing.destroy();
          this.charts.delete(measurement.name);
        } else {
          const data = existing.data ?? existing.config?.data;
          const options = existing.options ?? existing.config?.options;
          if (!data || !options) {
            existing.destroy();
            this.charts.delete(measurement.name);
          } else {
            data.labels = labels;
            data.datasets[0].data = values;
            data.datasets[0].borderColor = accent;
            data.datasets[0].backgroundColor = accentFill;
          if (options.plugins?.title) {
            options.plugins.title.color = fg;
          }
          options.interaction = chartInteraction;
          options.hover = {
            ...(options.hover ?? {}),
            intersect: false,
            mode: 'index'
          };
          if (options.scales?.x) {
              options.scales.x.grid = { ...(options.scales.x.grid ?? {}), color: border };
              options.scales.x.ticks = { ...(options.scales.x.ticks ?? {}), color: muted };
            }
            if (options.scales?.y) {
              options.scales.y.grid = { ...(options.scales.y.grid ?? {}), color: border };
              options.scales.y.ticks = { ...(options.scales.y.ticks ?? {}), color: muted };
            }
            existing.update?.('none');
            continue;
          }
        }
      }

      this.charts.set(measurement.name, new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              data: values,
              borderColor: accent,
              backgroundColor: accentFill,
              borderWidth: 2,
              fill: true,
              pointRadius: 0,
              tension: 0.25
            }
          ]
        },
        options: {
          animation: false,
          interaction: chartInteraction,
          hover: {
            intersect: false,
            mode: 'index'
          },
          maintainAspectRatio: false,
          responsive: true,
          plugins: {
            legend: {
              display: false
            },
            title: {
              display: false,
              color: fg
            }
          },
          scales: {
            x: {
              display: false,
              grid: {
                color: border
              },
              ticks: {
                color: muted
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: border
              },
              ticks: {
                color: muted
              }
            }
          }
        }
      }));
    }
  }
}

if (!customElements.get('nodel-diagnostic-charts')) {
  customElements.define('nodel-diagnostic-charts', NodelDiagnosticCharts);
}
