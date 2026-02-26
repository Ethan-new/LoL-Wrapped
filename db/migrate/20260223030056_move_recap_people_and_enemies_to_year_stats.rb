# frozen_string_literal: true

class MoveRecapPeopleAndEnemiesToYearStats < ActiveRecord::Migration[8.1]
  def up
    add_column :recap_year_stats, :most_played_with, :jsonb, default: []
    add_column :recap_year_stats, :most_beat_us, :jsonb, default: []

    # Migrate existing data (use table names since models may be removed)
    recap_people_klass = Class.new(ActiveRecord::Base) { self.table_name = "recap_people" }
    recap_enemies_klass = Class.new(ActiveRecord::Base) { self.table_name = "recap_enemies" }

    RecapYearStat.find_each do |stat|
      people = recap_people_klass
        .where(player_id: stat.player_id, year: stat.year)
        .where("games > 1")
        .order(games: :desc, wins_together: :desc)
        .limit(10)
        .map do |r|
          {
            "teammate_puuid" => r.teammate_puuid,
            "teammate_riot_id" => r.teammate_riot_id,
            "teammate_name" => teammate_display_name(r.teammate_riot_id, r.teammate_puuid),
            "games" => r.games,
            "wins_together" => r.wins_together
          }
        end

      enemies = recap_enemies_klass
        .where(player_id: stat.player_id, year: stat.year)
        .where("times_beat_us > 1")
        .order(times_beat_us: :desc)
        .limit(10)
        .map do |r|
          {
            "enemy_puuid" => r.enemy_puuid,
            "enemy_riot_id" => r.enemy_riot_id,
            "enemy_name" => teammate_display_name(r.enemy_riot_id, r.enemy_puuid),
            "times_beat_us" => r.times_beat_us
          }
        end

      stat.update_columns(most_played_with: people, most_beat_us: enemies)
    end

    drop_table :recap_people
    drop_table :recap_enemies
  end

  def down
    create_table :recap_people do |t|
      t.references :player, null: false, foreign_key: true
      t.integer :year, null: false
      t.string :teammate_puuid, null: false
      t.integer :games, default: 0, null: false
      t.integer :wins_together, default: 0, null: false
      t.string :teammate_riot_id

      t.timestamps
    end
    add_index :recap_people, %i[player_id year teammate_puuid], unique: true
    add_index :recap_people, %i[player_id year games]

    create_table :recap_enemies do |t|
      t.references :player, null: false, foreign_key: true
      t.integer :year, null: false
      t.string :enemy_puuid, null: false
      t.integer :times_beat_us, default: 0, null: false
      t.string :enemy_riot_id

      t.timestamps
    end
    add_index :recap_enemies, %i[player_id year enemy_puuid], unique: true

    # Restore data from JSONB (use table names since models are removed)
    recap_people = Class.new(ActiveRecord::Base) { self.table_name = "recap_people" }
    recap_enemies = Class.new(ActiveRecord::Base) { self.table_name = "recap_enemies" }

    RecapYearStat.find_each do |stat|
      people_rows = (stat.most_played_with || []).map do |p|
        {
          player_id: stat.player_id,
          year: stat.year,
          teammate_puuid: p["teammate_puuid"],
          teammate_riot_id: p["teammate_riot_id"],
          games: p["games"] || 0,
          wins_together: p["wins_together"] || 0,
          created_at: Time.current,
          updated_at: Time.current
        }
      end
      recap_people.insert_all(people_rows) if people_rows.any?

      enemy_rows = (stat.most_beat_us || []).map do |e|
        {
          player_id: stat.player_id,
          year: stat.year,
          enemy_puuid: e["enemy_puuid"],
          enemy_riot_id: e["enemy_riot_id"],
          times_beat_us: e["times_beat_us"] || 0,
          created_at: Time.current,
          updated_at: Time.current
        }
      end
      recap_enemies.insert_all(enemy_rows) if enemy_rows.any?
    end

    remove_column :recap_year_stats, :most_played_with
    remove_column :recap_year_stats, :most_beat_us
  end

  private

  def teammate_display_name(riot_id, puuid)
    return riot_id if riot_id.present?
    return "…#{puuid[-6..]}" if puuid.to_s.length >= 6
    "Unknown"
  end
end
