# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.2].define(version: 2026_02_20_121359) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "plpgsql"

  create_table "matches", force: :cascade do |t|
    t.string "match_uid", null: false
    t.string "region", null: false
    t.datetime "game_start_at", null: false
    t.integer "year", null: false
    t.jsonb "raw_json", default: {}
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["match_uid"], name: "index_matches_on_match_uid", unique: true
    t.index ["region", "year"], name: "index_matches_on_region_and_year"
    t.index ["year"], name: "index_matches_on_year"
  end

  create_table "players", force: :cascade do |t|
    t.string "puuid", null: false
    t.string "riot_id"
    t.string "region"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.integer "summoner_level"
    t.string "summoner_id"
    t.integer "profile_icon_id"
    t.bigint "revision_date"
    t.jsonb "rank_entries", default: []
    t.datetime "last_synced_at"
    t.jsonb "year_match_ids", default: {}
    t.index ["puuid"], name: "index_players_on_puuid", unique: true
  end

  create_table "recap_enemies", force: :cascade do |t|
    t.bigint "player_id", null: false
    t.integer "year", null: false
    t.string "enemy_puuid", null: false
    t.integer "times_beat_us", default: 0, null: false
    t.string "enemy_riot_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["player_id", "year", "enemy_puuid"], name: "index_recap_enemies_on_player_id_and_year_and_enemy_puuid", unique: true
    t.index ["player_id"], name: "index_recap_enemies_on_player_id"
  end

  create_table "recap_people", force: :cascade do |t|
    t.bigint "player_id", null: false
    t.integer "year", null: false
    t.string "teammate_puuid", null: false
    t.integer "games", default: 0, null: false
    t.integer "wins_together", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "teammate_riot_id"
    t.index ["player_id", "year", "games"], name: "index_recap_people_on_player_id_and_year_and_games"
    t.index ["player_id", "year", "teammate_puuid"], name: "index_recap_people_on_player_id_and_year_and_teammate_puuid", unique: true
    t.index ["player_id"], name: "index_recap_people_on_player_id"
  end

  create_table "recap_year_stats", force: :cascade do |t|
    t.bigint "player_id", null: false
    t.integer "year", null: false
    t.integer "total_pings", default: 0, null: false
    t.jsonb "ping_breakdown", default: {}
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "total_game_seconds", default: 0, null: false
    t.bigint "total_gold_spent", default: 0, null: false
    t.jsonb "fav_items", default: []
    t.jsonb "extra_stats", default: {}
    t.jsonb "our_team_bans", default: []
    t.jsonb "enemy_team_bans", default: []
    t.bigint "total_kills", default: 0, null: false
    t.bigint "total_deaths", default: 0, null: false
    t.bigint "total_assists", default: 0, null: false
    t.index ["player_id", "year"], name: "index_recap_year_stats_on_player_id_and_year", unique: true
    t.index ["player_id"], name: "index_recap_year_stats_on_player_id"
  end

  add_foreign_key "recap_enemies", "players"
  add_foreign_key "recap_people", "players"
  add_foreign_key "recap_year_stats", "players"
end
