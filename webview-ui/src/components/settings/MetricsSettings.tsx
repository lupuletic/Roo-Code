import { BarChart3 } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import CodeMetricsPanel from "../metrics/CodeMetricsPanel"

export type MetricsSettingsProps = {
	setCachedStateField: SetCachedStateField<any>
}

export const MetricsSettings = ({ setCachedStateField }: MetricsSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<BarChart3 className="w-4" />
					<div>{t("settings:sections.metrics")}</div>
				</div>
			</SectionHeader>

			<Section>
				<CodeMetricsPanel />
			</Section>
		</>
	)
}
