package app;

import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import skadistats.clarity.event.Insert;
import skadistats.clarity.model.CombatLogEntry;
import skadistats.clarity.model.Entity;
import skadistats.clarity.model.s2.S2CombatLogEntry;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.gameevents.OnCombatLogEntry;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.source.MappedFileSource;

/** Temporary (ADR-055): is there per-hero visibility in a 7.41 replay? */
@UsesEntities
public class Probe {
  @Insert private Context ctx;
  @Insert private Entities es;
  boolean scanned;
  final Map<String, int[]> vis = new HashMap<>();

  @OnTickEnd
  public void onTickEnd(boolean synthetic) {
    if (scanned || ctx.getTick() < 60000) return;
    scanned = true;
    TreeSet<String> hits = new TreeSet<>();
    es.stream().forEach(e -> {
      for (String line : e.toString().split("\n")) {
        String[] c = line.split("\\|");
        if (c.length > 2 && c[2].matches("(?i).*(visib|tagged|fog|seen|reveal|spotted).*")) hits.add(e.getDtClass().getDtName().replaceAll("_Hero_.*", "_Hero_*") + " " + c[2].trim());
      }
    });
    hits.forEach(h -> System.out.println("field " + h));
  }

  @OnCombatLogEntry
  public void onCombatLog(CombatLogEntry e) {
    if (!(e instanceof S2CombatLogEntry s)) return;
    String k = s.getType().name();
    int[] c = vis.computeIfAbsent(k, x -> new int[4]);
    c[0]++;
    if (s.hasVisibleRadiant()) c[1]++;
    if (s.hasVisibleRadiant() && s.isVisibleRadiant()) c[2]++;
    if (s.hasVisibleDire() && s.isVisibleDire()) c[3]++;
  }

  public static void main(String[] args) throws Exception {
    Probe p = new Probe();
    new SimpleRunner(new MappedFileSource(args[0])).runWith(p);
    p.vis.forEach((k, c) -> System.out.println("combatlog " + k + " n=" + c[0] + " hasVisR=" + c[1] + " visR=" + c[2] + " visD=" + c[3]));
  }
}
