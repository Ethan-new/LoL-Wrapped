# frozen_string_literal: true

class CreateRecapPeople < ActiveRecord::Migration[7.2]
  def change
    create_table :recap_people do |t|
      t.references :player, null: false, foreign_key: true
      t.integer :year, null: false
      t.string :teammate_puuid, null: false
      t.integer :games, default: 0, null: false
      t.integer :wins_together, default: 0, null: false

      t.timestamps
    end

    add_index :recap_people, %i[player_id year teammate_puuid], unique: true
    add_index :recap_people, %i[player_id year games]
  end
end
