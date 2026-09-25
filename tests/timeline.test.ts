import assert from 'node:assert/strict';
import test from 'node:test';
import { isRoutineMonitoringEvent } from '../src/lib/timeline';

test('routine monitoring events remain in history but are grouped in the timeline', () => {
  assert.equal(isRoutineMonitoringEvent('agent.observed'), true);
  assert.equal(isRoutineMonitoringEvent('agent.rescheduled'), true);
  assert.equal(isRoutineMonitoringEvent('agent.progress_observed'), false);
  assert.equal(isRoutineMonitoringEvent('monitoring.rescheduled'), false);
  assert.equal(isRoutineMonitoringEvent('outcome.verified'), false);
});
