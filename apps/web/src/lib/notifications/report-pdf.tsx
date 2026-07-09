import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ScheduledReportData } from "./report-export";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 16, marginBottom: 8, fontWeight: "bold" },
  meta: { marginBottom: 16, color: "#444" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 4 },
  cell: { flex: 1 },
  header: { fontWeight: "bold", backgroundColor: "#f5f5f5" },
});

export function ScheduledReportPdf({ data }: { data: ScheduledReportData }) {
  const rows = data.rows ?? [];
  const keys = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.org_name ?? "Report"}</Text>
        <Text style={styles.meta}>{data.report_type}</Text>
        {data.report_date ? <Text style={styles.meta}>Date: {data.report_date}</Text> : null}
        {data.period_from && data.period_to ? (
          <Text style={styles.meta}>
            Period: {data.period_from} → {data.period_to}
          </Text>
        ) : null}
        {data.summary ? (
          <View style={{ marginBottom: 16 }}>
            {Object.entries(data.summary).map(([k, v]) => (
              <Text key={k}>
                {k}: {String(v)}
              </Text>
            ))}
          </View>
        ) : null}
        {keys.length > 0 ? (
          <View>
            <View style={[styles.row, styles.header]}>
              {keys.map((k) => (
                <Text key={k} style={styles.cell}>
                  {k}
                </Text>
              ))}
            </View>
            {rows.slice(0, 50).map((row, i) => (
              <View key={i} style={styles.row}>
                {keys.map((k) => (
                  <Text key={k} style={styles.cell}>
                    {String(row[k] ?? "")}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
