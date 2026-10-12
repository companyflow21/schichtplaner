"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimeSettingsData {
  whoCanUse: string;
  watchAutoStop: boolean;
  warningsEnabled: boolean;
  warningsMaxHours: number;
  useCategories: boolean;
  autoApprove: boolean;
}

interface TimeSettingsProps {
  timeSettings: TimeSettingsData;
  onUpdate: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

export function TimeSettings({
  timeSettings,
  onUpdate,
  isSaving,
}: TimeSettingsProps) {
  function handleTimeSettingsChange(partial: Partial<TimeSettingsData>) {
    onUpdate({
      timeSettings: {
        ...partial,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Zeiterfassung</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Einstellungen fuer die Zeiterfassung
        </p>
      </div>

      <Card className="p-6 space-y-6">
        {/* Who can use */}
        <div className="space-y-2">
          <Label>Wer kann Zeiten erfassen?</Label>
          <Select
            value={timeSettings.whoCanUse}
            onValueChange={(value) =>
              handleTimeSettingsChange({ whoCanUse: value })
            }
            disabled={isSaving}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Mitarbeiter</SelectItem>
              <SelectItem value="CHOOSE">Auswaehlen</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Auto-stop */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Stoppuhr automatisch stoppen</Label>
            <p className="text-xs text-muted-foreground">
              Die Stoppuhr wird automatisch nach der eingestellten Maximalzeit
              gestoppt
            </p>
          </div>
          <Switch
            checked={timeSettings.watchAutoStop}
            onCheckedChange={(checked) =>
              handleTimeSettingsChange({ watchAutoStop: checked })
            }
            disabled={isSaving}
          />
        </div>

        <Separator />

        {/* Warnings */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Warnungen aktivieren</Label>
              <p className="text-xs text-muted-foreground">
                Warnung anzeigen wenn Maximalstunden ueberschritten werden
              </p>
            </div>
            <Switch
              checked={timeSettings.warningsEnabled}
              onCheckedChange={(checked) =>
                handleTimeSettingsChange({ warningsEnabled: checked })
              }
              disabled={isSaving}
            />
          </div>

          {timeSettings.warningsEnabled && (
            <div className="space-y-2 ml-1 pl-4 border-l-2 border-muted">
              <Label>Maximale Stunden pro Tag</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={timeSettings.warningsMaxHours}
                onChange={(e) =>
                  handleTimeSettingsChange({
                    warningsMaxHours: parseInt(e.target.value, 10) || 10,
                  })
                }
                className="w-24"
                disabled={isSaving}
              />
            </div>
          )}
        </div>

        <Separator />

        {/* Categories */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Kategorien verwenden</Label>
            <p className="text-xs text-muted-foreground">
              Zeiterfassungen koennen einer Kategorie zugewiesen werden
            </p>
          </div>
          <Switch
            checked={timeSettings.useCategories}
            onCheckedChange={(checked) =>
              handleTimeSettingsChange({ useCategories: checked })
            }
            disabled={isSaving}
          />
        </div>

        <Separator />

        {/* Genehmigung */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Selbst erfasste Zeiten automatisch genehmigen</Label>
            <p className="text-xs text-muted-foreground">
              Stoppuhr, Check-in und eigene Einträge gelten ohne Prüfung in „Stunden und Lohn“ als genehmigt.
              Einträge und Änderungen der Prüfenden sind immer genehmigt.
            </p>
          </div>
          <Switch
            checked={timeSettings.autoApprove}
            onCheckedChange={(checked) =>
              handleTimeSettingsChange({ autoApprove: checked })
            }
            disabled={isSaving}
            aria-label="Selbst erfasste Zeiten automatisch genehmigen"
          />
        </div>
      </Card>
    </div>
  );
}
