# frozen_string_literal: true

class AddYearMatchIdsAndDropPlayerMatches < ActiveRecord::Migration[7.2]
  def up
    add_column :players, :year_match_ids, :jsonb, default: {}

    drop_table :player_matches
  end

  def down
    create_table :player_matches do |t|
      t.references :player, null: false, foreign_key: true
      t.references :match, null: false, foreign_key: true
      t.integer :team_id, null: false
      t.boolean :win, null: false
      t.string :participant_puuid, null: false

      t.timestamps
    end

    add_index :player_matches, %i[player_id match_id], unique: true
    add_index :player_matches, %i[player_id team_id]
    add_index :player_matches, :participant_puuid

    remove_column :players, :year_match_ids
  end
end
