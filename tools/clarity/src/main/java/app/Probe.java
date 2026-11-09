package app;

import java.util.List;
import java.util.regex.Pattern;
import skadistats.clarity.event.Insert;
import skadistats.clarity.model.Entity;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.processor.stringtables.StringTables;
import skadistats.clarity.processor.stringtables.UsesStringTable;
import skadistats.clarity.source.MappedFileSource;

/** Temporary: prints the property names we need, from one replay (ADR-055). */
@UsesEntities
@UsesStringTable("EntityNames")
public class Probe {
  static final Pattern KEEP = Pattern.compile("(?i)health|mana|visib|lifestate|hitems|charges|playerid|gold|gametime|gamestart|replicat|nameStringable|cellx|celly|vecorigin|selectedhero|teamnum|level|cooldown|neutral");
  boolean done;
  @Insert private Context ctx;
  @Insert private Entities es;
  @Insert private StringTables tables;

  Entity one(String dt) {
    return es.stream().filter(Entities.byDtName(dt)).findFirst().orElse(null);
  }

  void dump(String what, Entity e) {
    if (e == null) { System.out.println("== " + what + ": none"); return; }
    System.out.println("== " + what + " " + e.getDtClass().getDtName());
    for (String line : e.toString().split("\n")) if (KEEP.matcher(line).find()) System.out.println(line);
  }

  @OnTickEnd
  public void onTickEnd(boolean synthetic) {
    if (done) return;
    Entity rules = one("CDOTAGamerulesProxy");
    if (rules == null) return;
    Float t = rules.getProperty("m_pGameRules.m_fGameTime");
    Float st = rules.getProperty("m_pGameRules.m_flGameStartTime");
    if (t == null || st == null || st <= 0 || t - st < 900) return;
    done = true;
    System.out.println("tick " + ctx.getTick() + " game time " + (t - st));
    dump("rules", rules);
    List<Entity> heroes = es.stream().filter(e -> e.getDtClass().getDtName().startsWith("CDOTA_Unit_Hero_")).toList();
    int n = 0;
    for (Entity h : heroes) {
      if (n++ == 0) dump("hero", h);
      Integer item = h.getProperty("m_hItems.0000");
      if (n == 1 && item != null) {
        Entity it = es.getByHandle(item);
        dump("item0", it);
        if (it != null) {
          Integer idx = it.getProperty("m_pEntity.m_nameStringableIndex");
          System.out.println("item0 name: " + (idx == null ? null : tables.forName("EntityNames").getNameByIndex(idx)));
        }
      }
      System.out.println("hero " + h.getDtClass().getDtName() + " hp " + h.getProperty("m_iHealth") + " visible " + h.getProperty("m_iTaggedAsVisibleByTeam") + " pid " + h.getProperty("m_iPlayerID"));
    }
    dump("radiant data", one("CDOTA_DataRadiant"));
    dump("player resource", one("CDOTA_PlayerResource"));
  }

  public static void main(String[] args) throws Exception {
    new SimpleRunner(new MappedFileSource(args[0])).runWith(new Probe());
  }
}
