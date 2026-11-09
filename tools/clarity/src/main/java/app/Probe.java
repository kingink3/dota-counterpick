package app;

import java.util.Iterator;
import java.util.regex.Pattern;
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

  void dump(String what, Entity e) {
    if (e == null) { System.out.println("== " + what + ": none"); return; }
    System.out.println("== " + what + " " + e.getDtClass().getDtName());
    for (String line : e.toString().split("\n")) if (KEEP.matcher(line).find()) System.out.println(line);
  }

  @OnTickEnd
  public void onTickEnd(Context ctx, boolean synthetic) {
    if (done) return;
    Entities es = ctx.getProcessor(Entities.class);
    Entity rules = es.getByDtName("CDOTAGamerulesProxy");
    if (rules == null) return;
    Float t = rules.getProperty("m_pGameRules.m_fGameTime");
    Float st = rules.getProperty("m_pGameRules.m_flGameStartTime");
    if (t == null || st == null || st <= 0 || t - st < 900) return;
    done = true;
    System.out.println("tick " + ctx.getTick() + " game time " + (t - st));
    dump("rules", rules);
    Iterator<Entity> heroes = es.getAllByPredicate(e -> e.getDtClass().getDtName().startsWith("CDOTA_Unit_Hero_"));
    int n = 0;
    while (heroes.hasNext()) {
      Entity h = heroes.next();
      if (n++ == 0) dump("hero", h);
      Integer item = h.getProperty("m_hItems.0000");
      if (n == 1 && item != null) {
        Entity it = es.getByHandle(item);
        dump("item0", it);
        if (it != null) {
          Integer idx = it.getProperty("m_pEntity.m_nameStringableIndex");
          StringTables tables = ctx.getProcessor(StringTables.class);
          System.out.println("item0 name: " + (idx == null ? null : tables.forName("EntityNames").getNameByIndex(idx)));
        }
      }
      System.out.println("hero " + h.getDtClass().getDtName() + " hp " + h.getProperty("m_iHealth") + " visible " + h.getProperty("m_iTaggedAsVisibleByTeam") + " pid " + h.getProperty("m_iPlayerID"));
    }
    dump("radiant data", es.getByDtName("CDOTA_DataRadiant"));
    dump("player resource", es.getByDtName("CDOTA_PlayerResource"));
  }

  public static void main(String[] args) throws Exception {
    new SimpleRunner(new MappedFileSource(args[0])).runWith(new Probe());
  }
}
