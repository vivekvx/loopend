const routineMonitoringEventTypes = new Set([
  'agent.observed',
  'agent.rescheduled',
  'agent.check_scheduled',
  'agent.monitoring_enabled',
]);

export function isRoutineMonitoringEvent(type: string) {
  return routineMonitoringEventTypes.has(type);
}
