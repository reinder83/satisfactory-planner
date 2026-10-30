// "Export to Satisfactory Tools" on a factory's heading on the Factories page (#1209): the
// factory's lines in the phase shown as a .sft file (sft-export.ts), which the browser writes
// itself in both editions. Nothing is stored, sent or recalculated.
import { downloadBlob, toast } from './api.ts';
import { calcStage, calculated, phaseLabel, stage } from './session.ts';
import { sftFileName, sftFileText, sftTab } from './sft-export.ts';
import { shownGroupFlow } from './shown-group-flow.ts';
import { factoryGroupsState } from './views/factories.ts';
import { stageBudgets } from '../mining.ts';

// The tab's name in Satisfactory Tools, and the file's: "Iron & steel, Phase 3".
const sftTabName = (groupName: string, phaseKey: string) => `${groupName}, ${phaseLabel(phaseKey)}`;

// Writes the .sft file of factory group `groupId` in the phase shown, and says what to do with it.
export async function exportGroupToSft(groupId: string): Promise<void> {
  const storedStage = calcStage();
  const flow = shownGroupFlow(groupId);
  const group = factoryGroupsState().groups.find(entry => entry.id === groupId);
  if (!calculated || !storedStage || !flow || !group) return;
  const name = sftTabName(group.name, stage());
  const tab = sftTab(
    name,
    flow,
    storedStage.rows || [],
    stageBudgets(storedStage, calculated.settings),
  );
  if (!tab.request.production.length) {
    toast(
      `${group.name} has nothing to export in ${phaseLabel(stage())}: what its lines make stays in the factory or goes to the AWESOME Sink.`,
    );
    return;
  }
  const fileName = sftFileName(name);
  try {
    const text = await sftFileText([tab], new Date());
    downloadBlob(new Blob([text], { type: 'text/plain' }), fileName);
    toast(
      `Saved ${fileName}. On satisfactorytools.com, open the Production planner and choose Import.`,
    );
  } catch {
    toast('This browser could not write the file: it needs CompressionStream.', true);
  }
}
