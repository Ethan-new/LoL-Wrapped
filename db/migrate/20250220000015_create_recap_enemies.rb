# frozen_string_literal: true

class CreateRecapEnemies < ActiveRecord::Migration[7.2]
  def change
    create_table :recap_enemies do |t|
      t.references :player, null: false, foreign_key: true
      t.integer :year, null: false
      t.string :enemy_puuid, null: false
      t.integer :times_beat_us, default: 0, null: false
      t.string :enemy_riot_id

      t.timestamps
    end

    add_index :recap_enemies, %i[player_id year enemy_puuid], unique: true
  end
end
