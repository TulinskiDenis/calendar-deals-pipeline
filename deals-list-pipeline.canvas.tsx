import {
  Callout,
  Code,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type StageId =
  | "entry"
  | "compose"
  | "context"
  | "sources"
  | "branch"
  | "post"
  | "policy";

const STAGES: Array<{
  id: StageId;
  step: string;
  title: string;
  pattern: string;
  edge?: string;
}> = [
  {
    id: "entry",
    step: "01",
    title: "PaymentCalendarBuilderController",
    pattern: "Thin entry",
    edge: "BuildPaymentCalendarRequest",
  },
  {
    id: "compose",
    step: "02",
    title: "BuildStepsPipeline",
    pattern: "Function composition",
    edge: "contextBuilder.andThen(calendarBuilder)",
  },
  {
    id: "context",
    step: "03",
    title: "ContextBuilder",
    pattern: "Chain of responsibility",
    edge: "ProcessingParameters",
  },
  {
    id: "sources",
    step: "04",
    title: "CalendarBuilder",
    pattern: "Strategy · open/closed",
    edge: "Stream<PaymentCalendarRecord> per source",
  },
  {
    id: "branch",
    step: "05",
    title: "Handler → client → processor → converter",
    pattern: "Template method · registry · decorator",
    edge: "List<PaymentCalendarRecord>",
  },
  {
    id: "post",
    step: "06",
    title: "PostProcessingData",
    pattern: "Strategy · builder · template method",
    edge: "expanded rows",
  },
  {
    id: "policy",
    step: "07",
    title: "PostProcessingDealFilter",
    pattern: "Composite specification",
  },
];

const DETAILS: Record<
  StageId,
  { say: string; body: string; points: string[]; classes: string[] }
> = {
  entry: {
    say: "The controller correlates the request and starts one function. Source rules never live here.",
    body: "POST /api/v1/builder takes BuildPaymentCalendarRequest and returns the calendar rows. The only work on the edge is validation and putting calendar.uid on the MDC.",
    points: [
      "One dependency: BuildStepsPipeline.",
      "The HTTP contract stays stable when a source, a converter, or a filter is added.",
    ],
    classes: ["PaymentCalendarBuilderController", "BuildStepsPipeline"],
  },
  compose: {
    say: "The build is a typed function from request to rows. Stages compose; they do not share a god service.",
    body: "BuildStep<IN, OUT> is a Function. BuildStepsPipeline wires the two stages with andThen, so the controller depends on the composition, not on either stage.",
    points: [
      "ContextBuilder: request → ProcessingParameters.",
      "CalendarBuilder: parameters → List<PaymentCalendarRecord>.",
      "A further stage is another Function in the chain.",
    ],
    classes: ["BuildStep", "BuildStepsPipeline", "ContextBuilder", "CalendarBuilder"],
  },
  context: {
    say: "Context is assembled once, in a declared order, and only the handlers this request needs actually run.",
    body: "ContextBuilder decides which uploaded deal files and which booked-deal feeds this request includes, then runs the ContextDataHandler implementations that match. Each handler enriches the same ProcessingParameters.",
    points: [
      "A handler runs only when its deal family is in the request.",
      "Order is declared: rates, clients, securities, then portfolios and market context.",
      "Deal handlers later read a finished context. They do not each open the dictionaries.",
      "A repository facade is the single door to products, clients, securities, and exclusion rules.",
    ],
    classes: [
      "ContextBuilder",
      "ContextDataHandler",
      "RemoteRepositoryAccessFacade",
    ],
  },
  sources: {
    say: "A new deal source is a new Handler bean. CalendarBuilder does not grow a switch.",
    body: "Spring injects List<Handler>. The builder keeps handlers whose canHandle is true and flatMaps their streams into one list of calendar rows.",
    points: [
      "Selection is data-driven: an upload id for file-based deals, a flag for the booked-deal feed.",
      "One handler per deal family: credit deals, deposit deals, securities, financing deals, portfolios, and the booked book.",
      "Every handler returns the same type, Stream<PaymentCalendarRecord>, so the merge is uniform.",
    ],
    classes: ["CalendarBuilder", "Handler"],
  },
  branch: {
    say: "The straight source is client, processor, converter. Decorators appear only where a source needs extra behavior.",
    body: "Uploaded deal families share one shape. A source client fixes the HTTP fetch; a processor shapes the stream; a converter registered by deal family maps the row.",
    points: [
      "Credit deals are the straight line: drop rows with no end date, then the default processor looks up the credit-deals converter.",
      "The converter map is built from every Converter bean. Lookup replaces a switch on source.",
      "Financing deals: the processor drops one subtype, then a decorator splits the rest into business segments.",
      "Some credit deals arrive as many forecast rows. A decorator aggregates them by counterparty, dates, and currency, then calls the default processor.",
      "Same-day deals: the processor picks the converter from a type code on the row. A decorator is the seam around that processor.",
      "Booked deals sit beside this shape. Their payload differs, so that handler keeps its own client and converter, and fills instrument and account from the rules engine.",
    ],
    classes: [
      "SourceHolderClient",
      "DefaultProcessor",
      "Converter",
      "SegmentingDecorator",
      "AggregatingDecorator",
      "BookedDealsConverter",
    ],
  },
  post: {
    say: "Composite deals are expanded after the merge, on the canonical record, so source handlers stay unaware of that math.",
    body: "Post-processing runs two steps on the merged list. Exposure is calculated first and stored on the parameters. An expander then decides, per row, whether to split it into constituent deals.",
    points: [
      "Flagged financing rows go to the basket generator.",
      "A smaller set of financing rows, chosen by instrument kind, goes to the plain generator.",
      "Every other row passes through unchanged.",
      "Generators are Spring beans selected from a map by strategy name.",
      "A parameter builder assembles the generator input. A base generator shares copy, amount scaling, and liquidity lookup.",
    ],
    classes: [
      "PostProcessingData",
      "ExposureCalculator",
      "DealExpander",
      "ExpansionParamsBuilder",
      "DealGenerator",
    ],
  },
  policy: {
    say: "Membership in the calendar is a policy chain. A new rule is another filter with an order.",
    body: "ApplicationConfiguration sorts every PostProcessingDealFilter and reduces them with merge, which is logical AND. CalendarBuilder applies that one predicate after post-processing.",
    points: [
      "Order 1: CalendarRecordAcceptabilityFilter.",
      "Order 2: DealExclusionResolver evaluates dictionary exclusion rules through the rules engine.",
      "Order 3: a product filter checks product, source, and which date kind the product accepts.",
      "The product map refreshes when the dictionary publishes UpdateEvent.",
    ],
    classes: [
      "PostProcessingDealFilter",
      "CalendarRecordAcceptabilityFilter",
      "DealExclusionResolver",
      "DealProductFilter",
    ],
  },
};

export default function DealsListPipeline() {
  const [selected, setSelected] = useCanvasState<StageId>("pipeline-stage", "sources");
  const detail = DETAILS[selected];

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Deals list pipeline</H1>
        <Text tone="secondary">
          Payment Calendar Builder turns one build request into a list of
          calendar rows. Context is assembled once, each deal source is a
          plugin, and row policy runs only after every source has produced the
          same record type.
        </Text>
        <Text tone="tertiary" size="small">
          Payment calendar builder · deal families shown in generic names
        </Text>
      </Stack>

      <Grid columns={3} gap={16}>
        <Stat value="2" label="Composed build steps" />
        <Stat value="1 : 1" label="Handler per deal family, one merge" />
        <Stat value="3" label="Acceptance filters, AND-ed" />
      </Grid>

      <Grid columns="minmax(0, 1.05fr) minmax(0, 0.95fr)" gap={20}>
        <Stack gap={0}>
          <H2>Build flow</H2>
          <Text tone="tertiary" size="small">
            Select a stage. The payload type sits on the edge between stages.
          </Text>
          <Stack gap={0} style={{ marginTop: 12 }}>
            {STAGES.map((stage) => (
              <div key={stage.id}>
                <StageButton
                  stage={stage}
                  active={selected === stage.id}
                  onSelect={setSelected}
                />
                {stage.edge ? <FlowEdge label={stage.edge} /> : null}
              </div>
            ))}
            <Terminal />
          </Stack>
        </Stack>

        <Stack gap={12}>
          <H2>What this stage is for</H2>
          <Callout tone="neutral" title="Interview line">
            {detail.say}
          </Callout>
          <Text>{detail.body}</Text>
          <Stack gap={6}>
            {detail.points.map((point) => (
              <div key={point}>
                <Text tone="secondary" size="small">
                  {point}
                </Text>
              </div>
            ))}
          </Stack>
          <Divider />
          <H3>Classes</H3>
          <Row gap={6} wrap>
            {detail.classes.map((name) => (
              <span key={name}>
                <Pill size="sm" active={name === detail.classes[0]}>
                  {name}
                </Pill>
              </span>
            ))}
          </Row>
        </Stack>
      </Grid>

      <Divider />

      <Stack gap={10}>
        <H2>The repeating source branch</H2>
        <Text tone="secondary">
          Each uploaded deal family shares this shape. CalendarBuilder only
          sees the stream of calendar rows that comes out of it.
        </Text>
        <BranchStrip />
      </Stack>

      <Grid columns={3} gap={12}>
        <Variant
          title="Straight"
          example="Credit deals, deposit deals"
          body="Fetch by upload id, apply a local predicate, then the default processor looks up one converter by deal family."
        />
        <Variant
          title="Decorated"
          example="Financing deals, aggregated credit deals"
          body="A processor decorator adds family-specific behavior: drop a subtype and segment the rest, aggregate many rows into one deal, or choose a converter from a type code on the row."
        />
        <Variant
          title="Beside the registry"
          example="Booked deals"
          body="That feed has a different payload, so its handler keeps its own client and converter. Instrument and account come from the rules engine."
        />
      </Grid>

      <Divider />

      <Stack gap={10}>
        <H2>Patterns on the path</H2>
        <Text tone="secondary">
          Each pattern is a seam where a new source, a new dictionary fact, or
          a new acceptance rule can land without rewriting the build.
        </Text>
        <Table
          headers={["Pattern", "Where it sits", "What stays closed"]}
          columnAlign={["left", "left", "left"]}
          striped
          rows={[
            [
              "Pipeline",
              "BuildStep.andThen in BuildStepsPipeline",
              "Controller and the other stage",
            ],
            [
              "Chain of responsibility",
              "ContextDataHandler, filtered and ordered",
              "ContextBuilder's loop",
            ],
            [
              "Strategy",
              "List<Handler> chosen by canHandle",
              "CalendarBuilder",
            ],
            [
              "Template method",
              "Source client fetch, and the shared deal generator",
              "HTTP fetch and shared row math",
            ],
            [
              "Registry",
              "Map from deal family to Converter, built from every converter bean",
              "Processors, which only look up",
            ],
            [
              "Decorator",
              "Financing, aggregated credit deals, and same-day deals",
              "Default conversion",
            ],
            [
              "Builder",
              "Expansion parameter builder",
              "The two generators",
            ],
            [
              "Composite",
              "PostProcessingDealFilter.merge, ordered AND",
              "CalendarBuilder's final pass",
            ],
            [
              "Rules engine",
              "Exclusion rules; instrument and account on booked deals",
              "Filter and converter code",
            ],
            [
              "Facade",
              "RemoteRepositoryAccessFacade",
              "Handlers and generators",
            ],
          ]}
        />
      </Stack>

      <Callout tone="info" title="How a new deal family lands">
        Add a source client, a Converter bean for that family, and a Handler
        whose canHandle checks the request.
        The pipeline, the converter registry, and the acceptance chain pick
        it up. <Code>CalendarBuilder</Code> stays as it is.
      </Callout>
    </Stack>
  );
}

function StageButton({
  stage,
  active,
  onSelect,
}: {
  stage: (typeof STAGES)[number];
  active: boolean;
  onSelect: (id: StageId) => void;
}) {
  const theme = useHostTheme();
  return (
    <button
      type="button"
      onClick={() => onSelect(stage.id)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        border: `1px solid ${active ? theme.accent.primary : theme.stroke.primary}`,
        background: active ? theme.fill.tertiary : theme.bg.elevated,
        color: theme.text.primary,
        padding: "10px 12px",
        font: "inherit",
      }}
    >
      <Row gap={10} align="center" justify="space-between">
        <Stack gap={2}>
          <Text size="small" tone="tertiary">
            {stage.step} · {stage.pattern}
          </Text>
          <Text weight="semibold">{stage.title}</Text>
        </Stack>
        {active ? (
          <Text size="small" style={{ color: theme.accent.primary }}>
            Selected
          </Text>
        ) : null}
      </Row>
    </button>
  );
}

function FlowEdge({ label }: { label: string }) {
  const theme = useHostTheme();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "3px 0",
      }}
    >
      <div style={{ width: 1, height: 8, background: theme.stroke.primary }} />
      <span style={{ color: theme.text.tertiary, fontSize: 11 }}>{label}</span>
      <div style={{ width: 1, height: 8, background: theme.stroke.primary }} />
    </div>
  );
}

function Terminal() {
  const theme = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.stroke.secondary}`,
        background: theme.fill.quaternary,
        padding: "10px 12px",
      }}
    >
      <Text size="small" tone="tertiary">
        Result
      </Text>
      <Text weight="semibold">List&lt;PaymentCalendarRecord&gt;</Text>
    </div>
  );
}

function BranchStrip() {
  const theme = useHostTheme();
  const steps = [
    { title: "canHandle", detail: "This deal family is in the request" },
    { title: "Source client", detail: "Template-method fetch by upload id" },
    { title: "Processor", detail: "Plain, or a decorator around it" },
    { title: "Converter", detail: "Registry lookup by deal family" },
  ];
  return (
    <Row gap={8} align="stretch" wrap>
      {steps.map((step, index) => (
        <div key={step.title} style={{ display: "flex", alignItems: "stretch", gap: 8, flex: "1 1 160px" }}>
          <div
            style={{
              flex: 1,
              border: `1px solid ${theme.stroke.primary}`,
              background: theme.bg.elevated,
              padding: "10px 12px",
            }}
          >
            <Text size="small" tone="tertiary">
              {String(index + 1).padStart(2, "0")}
            </Text>
            <Text weight="semibold">{step.title}</Text>
            <Text size="small" tone="secondary">
              {step.detail}
            </Text>
          </div>
          {index < steps.length - 1 ? (
            <div style={{ display: "flex", alignItems: "center", color: theme.text.tertiary }}>
              →
            </div>
          ) : null}
        </div>
      ))}
    </Row>
  );
}

function Variant({
  title,
  example,
  body,
}: {
  title: string;
  example: string;
  body: string;
}) {
  const theme = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${theme.stroke.secondary}`,
        background: theme.bg.elevated,
        padding: 12,
      }}
    >
      <Text weight="semibold">{title}</Text>
      <Text size="small" tone="tertiary">
        {example}
      </Text>
      <Text size="small" tone="secondary" style={{ marginTop: 6 }}>
        {body}
      </Text>
    </div>
  );
}
