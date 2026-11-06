export type {
  FigmaModel,
  FigmaType,
  FigmaVariable,
} from '@vertekum/ext-export-figma';
export { type ApplyReport, apply } from './apply';
export {
  type Binding,
  bindingFor,
  mismatch,
  parseBinding,
} from './binding';
export { type CompositionReadout, compositionReadout } from './compositions';
export { deprecationIn, withDeprecation } from './deprecation';
export { diff, type HostDrift, hostDrift } from './diff';
export { FakeHost } from './fake-host';
export {
  type ModelIssue,
  readModel,
  SUPPORTED_MODEL_VERSIONS,
} from './model';
export { plan } from './plan';
export { type RetiredStyle, type Retirement, retired } from './retire';
export { type StyleForm, styleForm } from './style-form';
export {
  type CollectionDiff,
  DEFAULT_POLICY,
  type HostAdapter,
  type HostSnapshot,
  type ModelDiff,
  normalizeNumbers,
  type Op,
  type Plan,
  type PlanPolicy,
  type SnapshotCollection,
  type SnapshotStyle,
  type SnapshotVariable,
  type Stamp,
  type StyleBinding,
  type StyleDiff,
  stable,
  type VariableDiff,
  type VariableState,
} from './types';
